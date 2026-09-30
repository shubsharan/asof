import { pendingResearch, researchHistory, researchSummary } from "@/domain/research";
import { useState } from "react";
import type { Evidence, Run } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { useAsOf } from "./asof";
import { companyHypothesisPath, companyPath } from "./routes";
import { SourceInspector } from "./SnapshotDialog";
import { HistoryControls } from "./TimeScrubber";
import { api, CompanyAvatar, EvidenceRow, formatDate, formatResearchTime, notifyRunsChanged, Prose, researchLink, useApi, useCompany, usePolling, VerdictBadge, withAsOf } from "./shared";
import { usePortfolio } from "./usePortfolio";

export function HypothesisDetail({ companyId, hypothesisId }: { companyId: string; hypothesisId: string }) {
  const { company, raw } = useCompany(companyId);
  const { asOf, mode, assessmentId } = useAsOf();
  const { activeRuns } = usePortfolio();
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const { data: runs, reload } = useApi<Run[]>(`/api/runs?companyId=${companyId}&hypothesisId=${hypothesisId}`);
  const running = activeRuns.some((run) => run.companyId === companyId && run.hypothesisId === hypothesisId);
  usePolling(reload, 3000, running);
  const hypothesis = company?.hypotheses.find(({ id }) => id === hypothesisId);
  const rawHypothesis = raw?.hypotheses.find(({ id }) => id === hypothesisId);
  if (!company || !hypothesis || !rawHypothesis) return null;

  const recorded = researchHistory(rawHypothesis);
  const reconstructions = researchHistory(rawHypothesis, "reconstruction");
  const history = mode === "reconstruction" ? reconstructions : recorded;
  const selectedId = hypothesis.history.at(-1)?.id;
  const latest = assessmentId === undefined || assessmentId === selectedId ? history.find((item) => item.id === selectedId) : undefined;
  const unknownTime = (rawHypothesis.researchHistory ?? []).filter((item) => item.origin === "legacy" && !item.recordedAt?.includes("T"));
  const cited = new Set(latest?.evidenceIds ?? []);
  const decisive = new Set(latest?.decisiveEvidenceIds ?? []);
  const decisiveClaims = hypothesis.evidence.filter((item) => item.kind === "claim" && decisive.has(item.id));
  const citedSources = hypothesis.evidence.filter((item) => cited.has(item.id) && !decisiveClaims.some((claim) => claim.id === item.id));
  const pending = mode === "recorded" && !asOf && assessmentId === undefined ? pendingResearch(rawHypothesis) : { leads: [], claims: [] };
  const pendingIds = new Set([...pending.leads, ...pending.claims].map((item) => item.id));
  const other = hypothesis.evidence.filter((item) => !cited.has(item.id) && !decisive.has(item.id) && !pendingIds.has(item.id));
  const path = companyHypothesisPath(companyId, hypothesisId);
  const latestReconstruction = reconstructions.at(-1);
  const lastRun = runs?.[0];

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

  return <>
    <a className="flex items-center gap-2 text-sm text-muted-foreground hover:underline" href={withAsOf(companyPath(companyId), asOf)}><CompanyAvatar company={company} className="size-5" />{company.name}</a>
    <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
      <h1 className="max-w-3xl text-2xl font-semibold">{hypothesis.statement}</h1>
      {mode === "recorded" && !asOf && assessmentId === undefined && <Button onClick={refresh} disabled={starting || running}>{starting || running ? "Researching..." : "Refresh research"}</Button>}
    </div>
    <p className="mt-2 text-sm text-muted-foreground">Exa researches this question and records an assessment with sources.</p>
    <HistoryControls companyId={companyId} hypothesisId={hypothesisId} />
    {(starting || running) && <p role="status" className="mt-4 text-sm">Exa is researching this question. The result will appear here when it is ready.</p>}
    {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    {lastRun?.status === "failed" && !running && <p role="alert" className="mt-4 text-sm text-destructive">Research could not finish: {lastRun.error}</p>}

    {assessmentId !== undefined && !latest ? <p role="alert" className="mt-8 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">This assessment is unavailable in the selected history.</p> : latest ? <section className="mt-8">
      <div className="flex flex-wrap items-center gap-3"><VerdictBadge verdict={latest.verdict} /><span className="text-xs text-muted-foreground">{mode === "reconstruction" ? `Reconstruction · cutoff ${formatDate(latest.targetDate ?? latest.asOf)} · generated ${latest.recordedAt ? formatResearchTime(latest.recordedAt) : "at an unavailable time"}` : `Recorded AI assessment · ${latest.recordedAt ? formatResearchTime(latest.recordedAt) : "time unavailable"}`}</span></div>
      {mode === "reconstruction" && <p className="mt-2 text-xs text-muted-foreground">This is retrospective research using a publication cutoff. Saved page text may have been captured later and does not prove what was known at the cutoff.</p>}
      <ResearchReasoning text={latest.reasoning} />
      <div className="mt-5"><h2 className="text-sm font-medium">What changed</h2><p className="mt-1 text-sm text-muted-foreground">{latest.changeReason ?? "This assessment did not record a change summary."}</p></div>
      {!!latest.openQuestions.length && <details className="mt-5"><summary className="cursor-pointer text-sm font-medium">What to watch next</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{latest.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul></details>}
    </section> : <p className="mt-8 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">{mode === "reconstruction" ? "No reconstruction for this cutoff." : asOf ? "No recorded assessment by this date." : "No recorded assessment yet. Refresh research to get an answer with sources."}</p>}

    {mode === "recorded" && !latest && latestReconstruction && <p className="mt-4 text-sm text-muted-foreground">A separate <a className="underline" href={researchLink(path, { mode: "reconstruction", asOf: latestReconstruction.asOf, assessmentId: latestReconstruction.id })}>reconstruction for cutoff {formatDate(latestReconstruction.asOf)}</a> was generated {latestReconstruction.recordedAt ? formatResearchTime(latestReconstruction.recordedAt) : "at an unavailable time"}.</p>}
    {rawHypothesis.rubric && <details className="mt-7 border-t pt-4"><summary className="cursor-pointer text-sm font-medium">What would support or challenge this?</summary><div className="mt-3 grid gap-4 text-sm sm:grid-cols-2"><div><h3 className="font-medium">Supporting signals</h3><ul className="mt-1 list-disc pl-5 text-muted-foreground">{rawHypothesis.rubric.supportingSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul></div><div><h3 className="font-medium">Challenging signals</h3><ul className="mt-1 list-disc pl-5 text-muted-foreground">{rawHypothesis.rubric.challengingSignals.map((signal) => <li key={signal}>{signal}</li>)}</ul></div></div><p className="mt-3 text-xs text-muted-foreground">Comparison period: {rawHypothesis.rubric.period}</p></details>}
    {!!decisiveClaims.length && <section className="mt-8"><h2 className="font-medium">Decisive claims</h2><SourceList evidence={decisiveClaims} asOf={asOf} /></section>}
    {!!citedSources.length && <section className="mt-8"><h2 className="font-medium">Sources cited in this assessment</h2><SourceList evidence={citedSources} asOf={asOf} /></section>}
    {!!pending.claims.length && <details className="mt-8 border-t pt-4"><summary className="cursor-pointer text-sm">Passage-backed claims awaiting research ({pending.claims.length})</summary><SourceList evidence={pending.claims} /></details>}
    {!!pending.leads.length && <details className="mt-8 border-t pt-4"><summary className="cursor-pointer text-sm">Unresolved source leads ({pending.leads.length})</summary><SourceList evidence={pending.leads} /></details>}
    {!!other.length && <details className="mt-8 border-t pt-4"><summary className="cursor-pointer text-sm">Other collected sources ({other.length})</summary><SourceList evidence={other} asOf={asOf} /></details>}
    {!!history.length && <details className="mt-8 border-t pt-4"><summary className="cursor-pointer text-sm">Earlier {mode === "reconstruction" ? "reconstructions" : "recorded research"}</summary><ol className="mt-4 divide-y">{[...history].reverse().map((item) => <li key={item.id} className="py-3"><a className="flex flex-wrap items-center gap-3 text-sm underline" href={researchLink(path, { mode, asOf: item.asOf, assessmentId: item.id })}><span>{mode === "reconstruction" ? `Cutoff ${formatDate(item.targetDate ?? item.asOf)} · generated ${item.recordedAt ? formatResearchTime(item.recordedAt) : "at an unavailable time"}` : item.recordedAt ? formatResearchTime(item.recordedAt) : "Recording time unavailable"}</span><VerdictBadge verdict={item.verdict} /></a><p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{researchSummary(item.reasoning).replace(/\*\*/g, "")}</p></li>)}</ol></details>}
    {!!unknownTime.length && <details className="mt-5 border-t pt-4"><summary className="cursor-pointer text-sm">Legacy research with recording time unavailable ({unknownTime.length})</summary><ul className="mt-3 space-y-3 text-sm text-muted-foreground">{unknownTime.map((item) => <li key={item.id}><span>Recording time unavailable{item.originalAsOf ? ` · stored date ${formatDate(item.originalAsOf)}` : ""}</span><p className="mt-1">{researchSummary(item.reasoning)}</p></li>)}</ul></details>}
  </>;
}

function ResearchReasoning({ text }: { text: string }) {
  const summary = researchSummary(text);
  return <div className="mt-4 text-sm leading-relaxed"><Prose text={summary} />{summary !== text.trim() && <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Read full analysis</summary><Prose text={text} className="mt-3" /></details>}</div>;
}

function SourceList({ evidence, asOf }: { evidence: Evidence[]; asOf?: string }) {
  return <><ul className="mt-2 divide-y">{evidence.slice(0, 5).map((item) => <EvidenceRow key={item.id} evidence={item} action={<SourceInspector evidence={item} asOf={asOf} />} />)}</ul>{evidence.length > 5 && <details className="mt-3"><summary className="cursor-pointer text-sm underline">Show {evidence.length - 5} more sources</summary><ul className="divide-y">{evidence.slice(5).map((item) => <EvidenceRow key={item.id} evidence={item} action={<SourceInspector evidence={item} asOf={asOf} />} />)}</ul></details>}</>;
}
