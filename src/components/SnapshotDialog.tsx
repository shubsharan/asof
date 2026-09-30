import { useEffect, useRef, useState } from "react";
import type { Evidence, SourceVersion } from "@/domain/types";
import { compareText, type TextChange, type TextComparison } from "@/domain/textComparison";
import type { SnapshotCapture } from "@/exa/snapshot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api, formatDate, formatDateTime } from "./shared";

type SnapshotResult = { now: SnapshotCapture; then?: SnapshotCapture };
type RetrievedCapture = Extract<SnapshotCapture, { status: "retrieved" }>;
type RequestSpec = { kind: "saved" } | { kind: "archive"; cutoff: string };
type ComparisonResult = { baseline: SnapshotCapture; baselineLabel: string; current: SnapshotCapture };

const RELATIONSHIPS = {
  company: "Company source", investor: "Investor", "customer-partner": "Customer or partner",
  independent: "Independent publisher", unknown: "Unknown publisher relationship",
};

/** Opens saved source evidence first, then compares it with fresh content on request. */
export function SourceInspector({ evidence, asOf }: { evidence: Evidence; asOf?: string }) {
  const fallbackCutoff = asOf ?? evidence.discoveredAt;
  const [date, setDate] = useState(fallbackCutoff.slice(0, 10));
  const [comparison, setComparison] = useState<ComparisonResult>();
  const [lastRequest, setLastRequest] = useState<RequestSpec>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestId = useRef(0);
  const pending = useRef(false);
  const saved = savedCapture(evidence.sourceVersion);
  const excerpt = evidence.excerpt ?? evidence.sourceVersion?.excerpt;
  const preview = excerpt ?? (saved ? textPreview(saved.text) : undefined);

  useEffect(() => {
    requestId.current++;
    setDate(fallbackCutoff.slice(0, 10));
    setComparison(undefined);
    setLastRequest(undefined);
    pending.current = false;
    setLoading(false);
    setError(undefined);
  }, [evidence.id, fallbackCutoff]);

  const compare = async (spec: RequestSpec) => {
    if (pending.current) return;
    pending.current = true;
    const id = ++requestId.current;
    setLoading(true);
    setError(undefined);
    setLastRequest(spec);
    try {
      const response = await api<SnapshotResult>("/api/snapshot", spec.kind === "saved"
        ? { url: evidence.url }
        : { url: evidence.url, asOf: spec.cutoff });
      if (id !== requestId.current) return;
      const baseline = spec.kind === "saved" ? saved : response.then;
      if (!baseline) throw new Error("Historical source content was not returned");
      setComparison({
        baseline,
        baselineLabel: spec.kind === "saved" ? "Saved source" : `Archived at or before ${formatDate(spec.cutoff)}`,
        current: response.now,
      });
    } catch (cause) {
      if (id === requestId.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (id === requestId.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  };

  const compareDefault = () => compare(saved ? { kind: "saved" } : { kind: "archive", cutoff: fallbackCutoff });
  const retry = () => compare(lastRequest ?? (saved ? { kind: "saved" } : { kind: "archive", cutoff: fallbackCutoff }));

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="block break-words text-left text-sm underline underline-offset-2" aria-label={`Open source details for ${evidence.title}`}>{evidence.title}</button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] min-w-0 overflow-x-hidden overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle className="break-words text-base leading-snug">{evidence.title}</DialogTitle>
          <DialogDescription className="break-all">{hostOf(evidence.url)}</DialogDescription>
        </DialogHeader>

        {preview ? (
          <section>
            <p className="mb-2 text-xs text-muted-foreground">{excerpt ? "Saved excerpt" : "Saved text preview"}{evidence.sourceVersion?.retrievedAt ? ` · ${formatDate(evidence.sourceVersion.retrievedAt)}` : ""}</p>
            <blockquote className="border-l-2 pl-3 text-sm leading-relaxed">{preview}</blockquote>
          </section>
        ) : <p className="text-sm text-muted-foreground">Saved page content is unavailable for this source.</p>}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild><a href={evidence.url} target="_blank" rel="noreferrer">Open original</a></Button>
          <Button size="sm" onClick={compareDefault} disabled={loading}>{loading ? "Comparing..." : "Compare with latest"}</Button>
        </div>

        <SourceDetails evidence={evidence} />

        {error && <div role="alert" className="rounded border border-destructive/40 p-3 text-sm"><p>Comparison failed: {error}</p><Button className="mt-2" size="sm" variant="outline" onClick={retry} disabled={loading}>Retry</Button></div>}
        {comparison && <Comparison result={comparison} retry={retry} loading={loading} date={date} onDateChange={(next) => {
          setDate(next);
          if (next) void compare({ kind: "archive", cutoff: next });
        }} />}
        {loading && !comparison && <p role="status" className="text-sm text-muted-foreground">Retrieving the latest page...</p>}
      </DialogContent>
    </Dialog>
  );
}

function SourceDetails({ evidence }: { evidence: Evidence }) {
  const version = evidence.sourceVersion;
  return (
    <details className="border-t pt-3 text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">Source details</summary>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">Publisher</dt><dd>{RELATIONSHIPS[evidence.relationship]}</dd>
        {evidence.publishedAt && <><dt className="text-muted-foreground">Published</dt><dd>{formatDateTime(evidence.publishedAt)}</dd></>}
        <dt className="text-muted-foreground">Found</dt><dd>{formatDateTime(evidence.discoveredAt)} via Exa {evidence.source}</dd>
        {evidence.sourceReasoning && <><dt className="text-muted-foreground">Source context</dt><dd>{evidence.sourceReasoning}</dd></>}
        {version && <><dt className="text-muted-foreground">Retrieved</dt><dd>{formatDateTime(version.retrievedAt)}</dd></>}
      </dl>
      {version?.status === "retrieved" && version.text && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-xs select-text">{version.text}</pre>}
      {version?.status === "unavailable" && <p className="mt-3 text-xs text-muted-foreground">Retrieval unavailable{version.error ? `: ${version.error}` : "."}</p>}
    </details>
  );
}

function Comparison({ result, retry, loading, date, onDateChange }: { result: ComparisonResult; retry: () => void; loading: boolean; date: string; onDateChange: (date: string) => void }) {
  const comparison = result.baseline.status === "retrieved" && result.current.status === "retrieved"
    ? compareText(result.baseline.text, result.current.text)
    : undefined;
  return (
    <section className="border-t pt-4" aria-live="polite">
      <h3 className="text-sm font-medium">{result.baselineLabel} compared with latest</h3>
      {comparison ? <TextChanges comparison={comparison} /> : (
        <div className="mt-3 rounded border p-3 text-sm">
          <p className="font-medium">Comparison incomplete</p>
          {result.baseline.status === "unavailable" && <p className="mt-1 text-muted-foreground">The earlier page could not be retrieved: {result.baseline.error}</p>}
          {result.current.status === "unavailable" && <p className="mt-1 text-muted-foreground">The latest page could not be retrieved: {result.current.error}</p>}
          <Button className="mt-3" size="sm" variant="outline" onClick={retry} disabled={loading}>Retry</Button>
        </div>
      )}
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground">Comparison details</summary>
        <label className="mt-3 grid max-w-48 gap-1 text-xs text-muted-foreground">Compare another date<input type="date" className="h-9 rounded border bg-background px-2 text-sm text-foreground" value={date} max={new Date().toISOString().slice(0, 10)} disabled={loading} onChange={(event) => onDateChange(event.target.value)} /></label>
        <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
          <FullCapture label={result.baselineLabel} capture={result.baseline} />
          <FullCapture label="Latest retrieval" capture={result.current} />
        </div>
      </details>
    </section>
  );
}

function TextChanges({ comparison }: { comparison: TextComparison }) {
  if (comparison.kind === "unchanged") return <p className="mt-3 rounded border p-3 text-sm">No text changes found.</p>;
  if (comparison.kind === "broad") return <div className="mt-3 space-y-3"><p className="text-xs text-muted-foreground">The pages are too different for sentence alignment. Showing the complete differing sections.</p><Change kind="removed" text={comparison.before} /><Change kind="added" text={comparison.after} /></div>;
  return <div className="mt-3 space-y-4">{comparison.passages.map((passage, index) => <div key={index} className="overflow-hidden rounded border">{passage.map((change, line) => <Change key={line} {...change} />)}</div>)}</div>;
}

function Change({ kind, text }: TextChange) {
  if (kind === "same") return <p className="px-3 py-2 text-sm text-muted-foreground">{text}</p>;
  return <div className={kind === "removed" ? "border-l-4 border-red-500 bg-red-50 px-3 py-2 text-red-950" : "border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-emerald-950"}><p className="mb-1 text-[0.65rem] font-semibold tracking-wide uppercase">{kind === "removed" ? "Removed" : "Added"}</p><p className="text-sm whitespace-pre-wrap">{text || "None"}</p></div>;
}

function FullCapture({ label, capture }: { label: string; capture: SnapshotCapture }) {
  return <section className="min-w-0"><h4 className="text-xs font-medium">{label}</h4><p className="mb-2 break-words text-xs text-muted-foreground">{formatDateTime(capture.retrievedAt)}{capture.status === "retrieved" && capture.snapshotAt ? ` · captured ${formatDateTime(capture.snapshotAt)}` : ""}</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border p-3 text-xs select-text">{capture.status === "retrieved" ? capture.text : `Unavailable: ${capture.error}`}</pre></section>;
}

function savedCapture(version: SourceVersion | undefined): RetrievedCapture | undefined {
  return version?.status === "retrieved" && version.text?.trim()
    ? { status: "retrieved", url: version.url, text: version.text, retrievedAt: version.retrievedAt }
    : undefined;
}

function textPreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 357).trimEnd()}...`;
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
