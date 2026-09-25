import { useCallback, useEffect, useState } from "react";
import type { Move } from "@/domain/changes";
import type { Direction, Evidence, Hypothesis, Job, Run, RunTarget } from "@/domain/types";
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

/** Signed points: "+4", "−6", "0". */
export const formatDelta = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0");

const DELTA_TONE = { up: "text-emerald-700", down: "text-red-700", flat: "text-muted-foreground", first: "text-sky-700" };

/**
 * What the last assessment did: "▲ 4", "▼ 6", "· 0", or "new" for a first assessment.
 * The number is the confidence delta in points; the glyph carries the direction for scanning.
 */
export function DeltaChip({ move, className = "" }: { move?: Move; className?: string }) {
  if (!move) return null;
  const tone = move.delta === undefined ? "first" : move.delta > 0 ? "up" : move.delta < 0 ? "down" : "flat";
  const label = move.delta === undefined ? "new" : `${tone === "up" ? "▲" : tone === "down" ? "▼" : "·"} ${Math.abs(move.delta)}`;
  const title = move.delta === undefined ? `First assessed ${formatDate(move.to.asOf)}` : `${move.from!.confidence}% → ${move.to.confidence}% on ${formatDate(move.to.asOf)}`;
  return (
    <span className={`font-mono text-xs tabular-nums ${DELTA_TONE[tone]} ${className}`} title={title}>
      {label}
    </span>
  );
}

/** "42s", "3m 5s", "1h 2m". */
export function formatDuration(fromIso: string, toIso: string) {
  const s = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/**
 * The one palette for direction, shared by evidence tags and verdicts (badges, dots, strip lines,
 * evidence bars) so the two can never disagree: green supports, yellow neutral, red contradicts.
 * Anything nobody has judged yet (unclassified evidence, an untested hypothesis) is muted.
 * The word always travels with the color.
 */
export const DIRECTION: Record<Direction | "unclassified", { solid: string; outline: string; dot: string; stroke: string; fill: string; text: string }> = {
  supports: { solid: "bg-emerald-100 text-emerald-800", outline: "border-emerald-300 text-emerald-700", dot: "bg-emerald-600", stroke: "stroke-emerald-600", fill: "fill-emerald-600", text: "text-emerald-700" },
  neutral: { solid: "bg-yellow-100 text-yellow-800", outline: "border-yellow-300 text-yellow-700", dot: "bg-yellow-500", stroke: "stroke-yellow-500", fill: "fill-yellow-500", text: "text-yellow-700" },
  contradicts: { solid: "bg-red-100 text-red-800", outline: "border-red-300 text-red-700", dot: "bg-red-600", stroke: "stroke-red-600", fill: "fill-red-600", text: "text-red-700" },
  unclassified: { solid: "bg-muted text-muted-foreground", outline: "border-dashed text-muted-foreground", dot: "bg-muted-foreground/40", stroke: "stroke-muted-foreground/40", fill: "fill-muted-foreground/40", text: "text-muted-foreground" },
};

/** The palette entry for a verdict or evidence tag; untested and unclassified share the muted one. */
export const tone = (d?: Direction | "untested") => DIRECTION[!d || d === "untested" ? "unclassified" : d];

/** A company's verdict on a hypothesis: "supports", "neutral", "contradicts" or "untested". */
export function VerdictBadge({ verdict }: { verdict: Hypothesis["verdict"] }) {
  return <Badge className={tone(verdict).solid}>{verdict}</Badge>;
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

export const JOB_LABELS: Record<Job, string> = { research: "Research", assess: "Assess", watch: "Watch" };

/** Direction of a piece of evidence; unclassified when nobody has judged it yet. */
export function EvidenceTypeBadge({ type }: { type?: Evidence["type"] }) {
  return (
    <Badge variant="outline" className={tone(type).outline}>
      {type ?? "unclassified"}
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

// ---- Prose ----

const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:https?:)?\/\/[^\s)]+\)|https?:\/\/[^\s)]+)/g;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(INLINE).map((part, i) => {
        if (i % 2 === 0) return part;
        if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        const md = part.match(/^\[([^\]]+)\]\((.+)\)$/);
        const [label, url] = md ? [md[1]!, md[2]!] : [hostOf(part), part];
        return (
          <a key={i} href={url} target="_blank" rel="noreferrer" className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground">
            {label}
          </a>
        );
      })}
    </>
  );
}

/**
 * Agent-written text as paragraphs, with the little Markdown it actually uses (bold, links) and bare
 * URLs rendered as links to their host, so reasoning never shows raw `[x](https://…)`.
 */
export function Prose({ text, className = "" }: { text: string; className?: string }) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className={`space-y-3 ${className}`}>
      {paragraphs.map((p, i) => (
        <p key={i}>
          <Inline text={p} />
        </p>
      ))}
    </div>
  );
}
