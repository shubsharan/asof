import { useCallback, useEffect, useState } from "react";
import type { Evidence, Hypothesis, Run, RunTarget } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { usePortfolio } from "./usePortfolio";

/** GET without a body, POST with one, or any `method`. Throws with the server's message on failure. */
export async function api<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const res = await fetch(
    path,
    body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error((await res.text()) || `${path} failed (${res.status})`);
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Tells every runs view on the page (tables, sidebar badge) that a run was started. */
export const notifyRunsChanged = () => document.dispatchEvent(new Event("asof:runs"));

export function useRunsChanged(fn: () => unknown) {
  useEffect(() => {
    document.addEventListener("asof:runs", fn);
    return () => document.removeEventListener("asof:runs", fn);
  }, [fn]);
}

/** Opens the research panel, optionally with a run already aimed at `target`. */
export const openResearch = (target?: RunTarget) => document.dispatchEvent(new CustomEvent("asof:research", { detail: target }));

export function useResearchRequests(fn: (target?: RunTarget) => void) {
  useEffect(() => {
    const handle = (e: Event) => fn((e as CustomEvent<RunTarget | undefined>).detail);
    document.addEventListener("asof:research", handle);
    return () => document.removeEventListener("asof:research", handle);
  }, [fn]);
}

/** GETs `path` (skipped while undefined) and refetches when it changes. */
export function useApi<T>(path: string | undefined) {
  const [data, setData] = useState<T>();
  const reload = useCallback(async () => {
    if (path) setData(await api<T>(path));
  }, [path]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, reload };
}

/** Calls `fn` every `ms` while `enabled`. */
export function usePolling(fn: () => unknown, ms: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(fn, ms);
    return () => clearInterval(timer);
  }, [fn, ms, enabled]);
}

/** `path` with `?asOf=` added when viewing a past date. Keeps any query `path` already has. */
export function withAsOf(path: string, asOf?: string) {
  if (!asOf) return path;
  return `${path}${path.includes("?") ? "&" : "?"}asOf=${asOf}`;
}

/**
 * One company from the portfolio: `company` as of the current cursor, `today` with everything,
 * and `reload` to refetch after a research run. Both are undefined until the portfolio has loaded.
 */
export function useCompany(id: string | undefined) {
  const { companies, companiesAsOf, reload } = usePortfolio();
  return { company: companiesAsOf.find((c) => c.id === id), today: companies.find((c) => c.id === id), reload };
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const formatConfidence = (c?: number) => (c === undefined ? "—" : `${c}%`);

/** "42s", "3m 5s", "1h 2m". */
export function formatDuration(fromIso: string, toIso: string) {
  const s = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/**
 * The one palette for hypothesis status, used by badges, dots and the strips' step lines so they
 * can never disagree. Green / blue / yellow / red were checked for color-vision separation; the
 * status word always travels with the color.
 */
export const STATUS: Record<Hypothesis["status"], { badge: string; dot: string; stroke: string; fill: string }> = {
  supported: { badge: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-600", stroke: "stroke-emerald-600", fill: "fill-emerald-600" },
  mixed: { badge: "bg-blue-100 text-blue-800", dot: "bg-blue-600", stroke: "stroke-blue-600", fill: "fill-blue-600" },
  "at-risk": { badge: "bg-yellow-100 text-yellow-800", dot: "bg-yellow-600", stroke: "stroke-yellow-600", fill: "fill-yellow-600" },
  contradicted: { badge: "bg-red-100 text-red-800", dot: "bg-red-700", stroke: "stroke-red-700", fill: "fill-red-700" },
  untested: { badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/40", stroke: "stroke-muted-foreground", fill: "fill-muted-foreground" },
};

export function StatusBadge({ status }: { status: Hypothesis["status"] }) {
  return <Badge className={STATUS[status].badge}>{status}</Badge>;
}

/** A small colored square, for places where a badge is too loud (matrix cells, evidence counts). */
export function StatusDot({ status, className = "" }: { status: Hypothesis["status"]; className?: string }) {
  return <span aria-hidden className={`inline-block size-2 rounded-[2px] ${STATUS[status].dot} ${className}`} />;
}

const RUN_STATUS_STYLES: Record<Run["status"], string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-sky-100 text-sky-800",
  done: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

export function RunStatusBadge({ status }: { status: Run["status"] }) {
  return <Badge className={RUN_STATUS_STYLES[status]}>{status}</Badge>;
}

export const RUN_KIND_LABELS: Record<Run["kind"], string> = { search: "Search", agent: "Agent", monitor: "Monitor pull" };

/** Direction colors for evidence: badges, tick marks and counts read from the same map. */
export const DIRECTION: Record<NonNullable<Evidence["type"]> | "unclassified", { badge: string; stroke: string; text: string }> = {
  supports: { badge: "border-emerald-300 text-emerald-700", stroke: "stroke-emerald-600", text: "text-emerald-700" },
  contradicts: { badge: "border-red-300 text-red-700", stroke: "stroke-red-700", text: "text-red-700" },
  neutral: { badge: "text-muted-foreground", stroke: "stroke-muted-foreground/60", text: "text-muted-foreground" },
  unclassified: { badge: "border-dashed text-muted-foreground", stroke: "stroke-muted-foreground/40", text: "text-muted-foreground" },
};

/** Direction of a piece of evidence; unclassified when nobody has judged it yet. */
export function EvidenceTypeBadge({ type }: { type?: Evidence["type"] }) {
  return type ? (
    <Badge variant="outline" className={DIRECTION[type].badge}>
      {type}
    </Badge>
  ) : (
    <Badge variant="outline" className="border-dashed text-muted-foreground">
      unclassified
    </Badge>
  );
}

const MS_PER_DAY = 86_400_000;

/** "Feb 10, 2026 · found Sep 24, 2026", or "undated, found …": publish date is when it became knowable, found is when AsOf saw it. */
export function evidenceDates(e: Evidence) {
  if (!e.publishedAt) return `undated, found ${formatDate(e.discoveredAt)}`;
  const gap = Math.abs(Date.parse(e.discoveredAt) - Date.parse(e.publishedAt));
  return gap > MS_PER_DAY ? `${formatDate(e.publishedAt)} · found ${formatDate(e.discoveredAt)}` : formatDate(e.publishedAt);
}

export function EvidenceRow({ evidence, context, action }: { evidence: Evidence; context?: string; action?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <EvidenceTypeBadge type={evidence.type} />
        <span>{evidenceDates(evidence)}</span>
        <span>· via {evidence.source}</span>
        {context && <span>· {context}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <p className="text-sm">{evidence.claim}</p>
      <a href={evidence.url} target="_blank" rel="noreferrer" className="truncate text-xs text-muted-foreground underline">
        {evidence.title}
      </a>
      {evidence.sourceReasoning && <p className="text-xs text-muted-foreground italic">{evidence.sourceReasoning}</p>}
    </li>
  );
}
