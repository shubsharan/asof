import { useCallback, useEffect, useState } from "react";
import type { Company, Evidence, Hypothesis } from "@/domain/types";
import { Badge } from "@/components/ui/badge";

/** GET without a body, POST with one. Throws with the server's message on failure. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    path,
    body === undefined
      ? undefined
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  return res.json();
}

/** A company as of `asOf` (default: today), with a way to reload it after research runs. */
export function useCompany(id: string, asOf?: string) {
  const [company, setCompany] = useState<Company>();
  const reload = useCallback(
    () => api<Company>(`/api/companies/${id}${asOf ? `?asOf=${asOf}` : ""}`).then(setCompany),
    [id, asOf],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  return { company, reload };
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const STATUS_STYLES: Record<Hypothesis["status"], string> = {
  supported: "bg-emerald-100 text-emerald-800",
  mixed: "bg-amber-100 text-amber-800",
  "at-risk": "bg-orange-100 text-orange-800",
  contradicted: "bg-red-100 text-red-800",
  untested: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: Hypothesis["status"] }) {
  return <Badge className={STATUS_STYLES[status]}>{status}</Badge>;
}

const TYPE_STYLES = {
  supports: "border-emerald-300 text-emerald-700",
  contradicts: "border-red-300 text-red-700",
  neutral: "text-muted-foreground",
};

/** Direction of a piece of evidence; unclassified when nobody has judged it yet. */
export function EvidenceTypeBadge({ type }: { type?: Evidence["type"] }) {
  return type ? (
    <Badge variant="outline" className={TYPE_STYLES[type]}>
      {type}
    </Badge>
  ) : (
    <Badge variant="outline" className="border-dashed text-muted-foreground">
      unclassified
    </Badge>
  );
}

export function EvidenceRow({ evidence, context, action }: { evidence: Evidence; context?: string; action?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <EvidenceTypeBadge type={evidence.type} />
        <span>{evidence.publishedAt ? formatDate(evidence.publishedAt) : `undated, found ${formatDate(evidence.discoveredAt)}`}</span>
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
