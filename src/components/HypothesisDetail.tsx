import { researchSummary } from "@/domain/research";
import { useState } from "react";
import type { Evidence, Run } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { useAsOf } from "./asof";
import { companyPath } from "./routes";
import { SourceInspector } from "./SnapshotDialog";
import { api, CompanyAvatar, EvidenceRow, formatDate, formatDateTime, notifyRunsChanged, Prose, useApi, useCompany, usePolling, VerdictBadge, withAsOf } from "./shared";
import { usePortfolio } from "./usePortfolio";

export function HypothesisDetail({ companyId, hypothesisId }: { companyId: string; hypothesisId: string }) {
  const { company, today: full } = useCompany(companyId);
  const { asOf, setAsOf } = useAsOf();
  const { activeRuns } = usePortfolio();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const { data: runs, reload } = useApi<Run[]>(`/api/runs?companyId=${companyId}&hypothesisId=${hypothesisId}`);
  const running = activeRuns.some((run) => run.companyId === companyId && run.hypothesisId === hypothesisId);
  usePolling(reload, 3000, running);
  const hypothesis = company?.hypotheses.find(({ id }) => id === hypothesisId);
  const fullHypothesis = full?.hypotheses.find(({ id }) => id === hypothesisId);
  if (!company || !hypothesis || !fullHypothesis) return null;
  const latest = hypothesis.history.at(-1);
  const cited = new Set(latest?.evidenceIds);
  const sources = hypothesis.evidence.filter(({ id }) => cited.has(id));
  const other = hypothesis.evidence.filter(({ id }) => !cited.has(id));
  const reconstruction = hypothesis.researchHistory?.find((item) => item.targetDate === latest?.asOf);
  const refresh = async () => {
    setStarting(true);
    setError(undefined);
    try {
      await api("/api/runs", { job: "assess", companyId, hypothesisId });
      notifyRunsChanged();
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setStarting(false); }
  };
  const lastRun = runs?.[0];
  return <>
    <a className="flex items-center gap-2 text-sm text-muted-foreground hover:underline" href={withAsOf(companyPath(companyId), asOf)}><CompanyAvatar company={company} className="size-5" />{company.name}</a>
    <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
      <h1 className="max-w-3xl text-2xl font-semibold">{hypothesis.statement}</h1>
      {!asOf && <Button onClick={refresh} disabled={starting || running}>{starting || running ? "Researching..." : "Refresh research"}</Button>}
    </div>
    <p className="mt-2 text-sm text-muted-foreground">Exa searches the web, weighs the sources, and assesses this question.</p>
    {asOf && <p className="mt-4 text-sm">Research as of {formatDate(asOf)}. <button className="underline" onClick={() => setAsOf(undefined)}>Back to latest</button></p>}
    {(starting || running) && <p role="status" className="mt-4 text-sm">Exa is researching this question. The result will appear here when it is ready.</p>}
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    {lastRun?.status === "failed" && !running && <p role="alert" className="mt-4 text-sm text-destructive">Research could not finish: {lastRun.error}</p>}
    {latest ? <section className="mt-8">
      <div className="flex flex-wrap items-center gap-3"><VerdictBadge verdict={latest.verdict} /><span className="text-xs text-muted-foreground">AI assessment · {formatDate(latest.asOf)}</span></div>
      {reconstruction && <p className="mt-2 text-xs text-muted-foreground">Historical reconstruction using sources published by this date.</p>}
      <ResearchReasoning text={latest.reasoning} />
      {!!latest.openQuestions.length && <details className="mt-5"><summary className="cursor-pointer text-sm font-medium">What to watch next</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{latest.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul></details>}
    </section> : <p className="mt-8 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{asOf ? "No research for this date." : "No assessment yet. Refresh research to get Exa's answer with supporting sources."}</p>}
    {!!sources.length && <section className="mt-8"><h2 className="font-medium">Sources behind this assessment</h2><SourceList evidence={sources} asOf={asOf} /></section>}
    {!!other.length && <details className="mt-8 border-t pt-4"><summary className="cursor-pointer text-sm">More sources found by Exa ({other.length})</summary><SourceList evidence={other} asOf={asOf} /></details>}
    {fullHypothesis.history.length > 1 && <details className="mt-8 border-t pt-4"><summary className="cursor-pointer text-sm">Earlier research</summary><ol className="mt-4 divide-y">{[...fullHypothesis.history].reverse().map((item, i) => <li key={`${item.asOf}:${i}`} className="py-3"><a className="flex flex-wrap items-center gap-3 text-sm underline" href={withAsOf(`/c/${companyId}/h/${hypothesisId}`, item.asOf)}><span>{formatDateTime(item.asOf)}</span><VerdictBadge verdict={item.verdict} /></a><p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{researchSummary(item.reasoning).replace(/\*\*/g, "")}</p></li>)}</ol></details>}
  </>;
}

function ResearchReasoning({ text }: { text: string }) {
  const summary = researchSummary(text);
  return <div className="mt-4 text-sm leading-relaxed"><Prose text={summary} />{summary !== text.trim() && <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Read full analysis</summary><Prose text={text} className="mt-3" /></details>}</div>;
}

function SourceList({ evidence, asOf }: { evidence: Evidence[]; asOf?: string }) {
  return <><ul className="mt-2 divide-y">{evidence.slice(0, 5).map((item) => <EvidenceRow key={item.id} evidence={item} action={<SourceInspector evidence={item} asOf={asOf} />} />)}</ul>{evidence.length > 5 && <details className="mt-3"><summary className="cursor-pointer text-sm underline">Show {evidence.length - 5} more sources</summary><ul className="divide-y">{evidence.slice(5).map((item) => <EvidenceRow key={item.id} evidence={item} action={<SourceInspector evidence={item} asOf={asOf} />} />)}</ul></details>}</>;
}
