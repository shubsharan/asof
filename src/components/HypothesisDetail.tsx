import { useEffect, useMemo, useRef, useState } from "react";
import { timeDomain } from "@/domain/timeline";
import type { Evidence, Run, RunKind } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { useAsOf } from "./asof";
import { ConfidenceStrip } from "./ConfidenceStrip";
import { usePortfolio } from "./usePortfolio";
import { companyPath } from "./routes";
import { SnapshotDialog } from "./SnapshotDialog";
import {
  api,
  EvidenceRow,
  formatConfidence,
  formatDate,
  formatDateTime,
  notifyRunsChanged,
  openResearch,
  RUN_KIND_LABELS,
  StatusBadge,
  useApi,
  useCompany,
  usePolling,
  useRunsChanged,
  withAsOf,
} from "./shared";

/** One cell of the matrix: the strip at full size, and the assessment the cursor is on. */
export function HypothesisDetail({ companyId, hypothesisId }: { companyId: string; hypothesisId: string }) {
  const { company, today: full, reload } = useCompany(companyId);
  const { companies } = usePortfolio();
  const { asOf, today, setAsOf } = useAsOf();
  const domain = useMemo(() => timeDomain(companies, today), [companies, today]);
  const [error, setError] = useState<string>();

  // Research runs in the background; follow the latest one for this hypothesis and reload when it ends.
  const { data: runs, reload: reloadRuns } = useApi<Run[]>(asOf ? undefined : `/api/runs?hypothesisId=${hypothesisId}`);
  const lastRun = runs?.[0];
  const running = lastRun?.status === "queued" || lastRun?.status === "running";
  usePolling(reloadRuns, 3000, running);
  useRunsChanged(reloadRuns);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) reload();
    wasRunning.current = running;
  }, [running, reload]);

  const h = company?.hypotheses.find((x) => x.id === hypothesisId);
  const fullH = full?.hypotheses.find((x) => x.id === hypothesisId);
  if (!company || !h || !fullH) return null;
  const latest = h.history.at(-1);
  const previous = h.history.at(-2);
  const cited = new Set(latest?.evidenceIds);
  const evidenceAfter = fullH.evidence.length - h.evidence.length;
  const assessmentsAfter = fullH.history.length - h.history.length;
  // Page snapshots only make sense for a past date.
  const snapshot = (e: Evidence) => asOf && <SnapshotDialog url={e.url} asOf={asOf} />;

  const start = async (kind: RunKind) => {
    setError(undefined);
    try {
      await api("/api/runs", { kind, companyId, hypothesisId });
      notifyRunsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        <a href={withAsOf(companyPath(companyId), asOf)} className="hover:underline">
          {company.name}
        </a>
      </p>
      <h1 className="text-2xl font-semibold">{h.statement}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-3xl font-semibold tabular-nums">
          {previous && <span className="text-muted-foreground">{previous.confidence}% → </span>}
          {h.confidence === undefined ? "Untested" : `${h.confidence}%`}
        </span>
        <StatusBadge status={h.status} />
        {latest && <span className="font-mono text-xs text-muted-foreground">assessed {formatDate(latest.asOf)}</span>}
        {asOf && (fullH.confidence !== h.confidence || fullH.status !== h.status) && (
          <span className="font-mono text-xs text-muted-foreground">
            · today {formatConfidence(fullH.confidence)} {fullH.status}
          </span>
        )}
        {!asOf && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => start("search")} disabled={running}>
              Search now
            </Button>
            <Button onClick={() => start("agent")} disabled={running}>
              Run deeper diligence
            </Button>
          </div>
        )}
      </div>
      {lastRun && <LastRun run={lastRun} />}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-6">
        <ConfidenceStrip hypothesis={fullH} domain={domain} asOf={asOf} today={today} size="full" onPickDate={setAsOf} />
        <p className="mt-1 text-xs text-muted-foreground">Click an assessment to move the cursor there.</p>
      </div>

      {latest ? (
        <div className="mt-8 grid gap-6 md:grid-cols-[3fr_2fr]">
          <section>
            <h2 className="mb-2 font-medium">Why, as of {formatDate(latest.asOf)}</h2>
            <p className="text-sm leading-relaxed whitespace-pre-line">{latest.reasoning.replaceAll("**", "") /* the Agent sometimes writes Markdown bold */}</p>
          </section>
          <section>
            <h2 className="mb-2 font-medium">Remaining concerns</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {latest.openQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
            {asOf && assessmentsAfter > 0 && (
              <p className="mt-4 text-xs text-muted-foreground">
                Reassessed {assessmentsAfter} more {assessmentsAfter === 1 ? "time" : "times"} after this date.
              </p>
            )}
          </section>
        </div>
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">
          {asOf ? `Not yet assessed by ${formatDate(asOf)}.` : "Not assessed yet. Run deeper diligence to get a first read."}
        </p>
      )}

      <EvidenceSection title="Cited in this assessment" evidence={h.evidence.filter((e) => cited.has(e.id))} action={snapshot} />
      <EvidenceSection title={asOf ? `Other evidence known by ${formatDate(asOf)}` : "Other evidence"} evidence={h.evidence.filter((e) => !cited.has(e.id))} action={snapshot} />
      {asOf && evidenceAfter > 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          +{evidenceAfter} more {evidenceAfter === 1 ? "item" : "items"} became knowable after this date.
        </p>
      )}
    </>
  );
}

function EvidenceSection({ title, evidence, action }: { title: string; evidence: Evidence[]; action: (e: Evidence) => React.ReactNode }) {
  if (!evidence.length) return null;
  return (
    <section className="mt-8">
      <h2 className="font-medium">
        {title} <span className="text-muted-foreground">({evidence.length})</span>
      </h2>
      <ul className="divide-y">
        {[...evidence].reverse().map((e) => (
          <EvidenceRow key={e.id} evidence={e} action={action(e)} />
        ))}
      </ul>
    </section>
  );
}

function LastRun({ run }: { run: Run }) {
  const kind = RUN_KIND_LABELS[run.kind];
  const research = (
    <button type="button" onClick={() => openResearch()} className="underline">
      Research
    </button>
  );
  if (run.status === "queued" || run.status === "running") {
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        {kind} run {run.status === "queued" ? "queued" : `running since ${formatDateTime(run.startedAt!)}`}
        {run.kind === "agent" && " (takes a few minutes)"}. You can leave this page; follow it in {research}.
      </p>
    );
  }
  if (run.status === "failed") {
    return (
      <p className="mt-2 text-sm text-destructive">
        Last {kind.toLowerCase()} run failed: {run.error}
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      Last {kind.toLowerCase()} run {formatDateTime(run.finishedAt!)}: +{run.result?.evidenceAdded ?? 0} evidence. History in {research}.
    </p>
  );
}
