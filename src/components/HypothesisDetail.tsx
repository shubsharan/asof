import { useEffect, useMemo, useRef, useState } from "react";
import { lastMove } from "@/domain/changes";
import { timeDomain } from "@/domain/timeline";
import type { Evidence, Job, Run } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { useAsOf } from "./asof";
import { HypothesisCompare } from "./Compare";
import { ConfidenceStrip } from "./ConfidenceStrip";
import { usePortfolio } from "./usePortfolio";
import { companyPath } from "./routes";
import { SnapshotDialog } from "./SnapshotDialog";
import {
  api,
  CompanyAvatar,
  DeltaChip,
  DIRECTION,
  EvidenceRow,
  formatDate,
  formatDateTime,
  notifyRunsChanged,
  openResearch,
  Prose,
  JOB_LABELS,
  useApi,
  useCompany,
  usePolling,
  useRunsChanged,
  VerdictBadge,
  withAsOf,
} from "./shared";

/** Below this many characters the reasoning is shown whole; above it, the first paragraph with a "Read more". */
const FOLD_CHARS = 700;

/**
 * One cell of the matrix: the strip at full size, and the assessment the cursor is on. The reading
 * leads with what the assessment cited (so the reader sees what moved it before the prose), and
 * when rewound a table compares that day with today.
 */
export function HypothesisDetail({ companyId, hypothesisId }: { companyId: string; hypothesisId: string }) {
  const { company, today: full, reload } = useCompany(companyId);
  const { companies } = usePortfolio();
  const { asOf, today, setAsOf } = useAsOf();
  const domain = useMemo(() => timeDomain(companies, today), [companies, today]);
  const [error, setError] = useState<string>();

  // Research runs in the background; follow the latest one for this hypothesis and reload when it ends.
  const { data: runs, reload: reloadRuns } = useApi<Run[]>(asOf ? undefined : `/api/runs?companyId=${companyId}&hypothesisId=${hypothesisId}`);
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
  const move = lastMove(h);
  const cited = new Set(latest?.evidenceIds);
  const citedEvidence = h.evidence.filter((e) => cited.has(e.id));
  const evidenceAfter = fullH.evidence.length - h.evidence.length;
  const assessmentsAfter = fullH.history.length - h.history.length;
  // Page snapshots only make sense for a past date.
  const snapshot = (e: Evidence) => asOf && <SnapshotDialog url={e.url} asOf={asOf} />;

  const start = async (job: Job) => {
    setError(undefined);
    try {
      await api("/api/runs", { job, companyId, hypothesisId });
      notifyRunsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <p className="text-sm text-muted-foreground">
        <a href={withAsOf(companyPath(companyId), asOf)} className="inline-flex items-center gap-2 hover:underline">
          <CompanyAvatar company={company} className="size-5" />
          {company.name}
        </a>
      </p>
      <h1 className="text-2xl font-semibold">{h.statement}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {h.verdict === "untested" ? (
          <span className="font-mono text-3xl font-semibold">Untested</span>
        ) : (
          <>
            <VerdictBadge verdict={h.verdict} />
            <span className="font-mono text-3xl font-semibold tabular-nums">{h.confidence}%</span>
            <span className="text-sm text-muted-foreground">confident</span>
          </>
        )}
        {move?.from && (
          <span className="font-mono text-sm text-muted-foreground tabular-nums">
            from {move.from.verdict} {move.from.confidence}% <DeltaChip move={move} className="text-sm" />
          </span>
        )}
        {latest && <span className="font-mono text-xs text-muted-foreground">assessed {formatDate(latest.asOf)}</span>}
        {!asOf && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => start("research")} disabled={running} title="Find and tag new evidence (Exa Search)">
              Research
            </Button>
            <Button onClick={() => start("assess")} disabled={running} title="Give a verdict and confidence (Exa Agent)">
              Assess
            </Button>
          </div>
        )}
      </div>
      {lastRun && <LastRun run={lastRun} />}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <div className="mt-6">
        <ConfidenceStrip hypothesis={fullH} domain={domain} asOf={asOf} today={today} size="full" onPickDate={setAsOf} />
        <p className="mt-1 text-xs text-muted-foreground">
          Click an assessment to move the cursor there.{!asOf && " Rewind to see any cited page as it read on that day."}
        </p>
      </div>

      {asOf && (
        <div className="mt-8">
          <HypothesisCompare view={h} full={fullH} asOf={asOf} />
        </div>
      )}

      {latest ? (
        <div className="mt-8 grid gap-6 md:grid-cols-[3fr_2fr]">
          <section>
            <h2 className="mb-2 font-medium">Why, as of {formatDate(latest.asOf)}</h2>
            <CitedSummary evidence={citedEvidence} />
            <Reasoning text={latest.reasoning} />
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
          {asOf ? `Not yet assessed by ${formatDate(asOf)}.` : "Not assessed yet. Assess it to get a first read."}
        </p>
      )}

      <EvidenceSection title="Cited in this assessment" evidence={citedEvidence} action={snapshot} />
      <EvidenceSection title={asOf ? `Other evidence known by ${formatDate(asOf)}` : "Other evidence"} evidence={h.evidence.filter((e) => !cited.has(e.id))} action={snapshot} />
      {asOf && evidenceAfter > 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          +{evidenceAfter} more {evidenceAfter === 1 ? "item" : "items"} became knowable after this date.
        </p>
      )}
    </>
  );
}

/** What the assessment rested on, by direction, before the reader gets to the prose. */
function CitedSummary({ evidence }: { evidence: Evidence[] }) {
  const n = (type?: string) => evidence.filter((e) => (e.type ?? "unclassified") === type).length;
  const parts: [label: string, count: number, tone: string][] = [
    ["supporting", n("supports"), DIRECTION.supports.text],
    ["contradicting", n("contradicts"), DIRECTION.contradicts.text],
    ["neutral", n("neutral"), DIRECTION.neutral.text],
    ["unclassified", n("unclassified"), DIRECTION.unclassified.text],
  ];
  return (
    <p className="mb-3 flex flex-wrap gap-x-3 font-mono text-xs tabular-nums">
      <span className="text-muted-foreground">Cited</span>
      {parts
        .filter(([, count]) => count)
        .map(([label, count, tone]) => (
          <span key={label} className={tone}>
            {count} {label}
          </span>
        ))}
    </p>
  );
}

/** Long Agent reasoning folds to its first paragraph until asked for. */
function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const paragraphs = text.split(/\n\s*\n/);
  const foldable = text.length > FOLD_CHARS && paragraphs.length > 1;
  const shown = foldable && !open ? paragraphs[0]! : text;
  return (
    <>
      <Prose text={shown} className="text-sm leading-relaxed" />
      {foldable && (
        <button type="button" onClick={() => setOpen(!open)} className="mt-2 text-xs text-muted-foreground underline underline-offset-2">
          {open ? "Show less" : `Read the full reasoning (${paragraphs.length - 1} more ${paragraphs.length === 2 ? "paragraph" : "paragraphs"})`}
        </button>
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
  const job = JOB_LABELS[run.job];
  const research = (
    <button type="button" onClick={() => openResearch()} className="underline">
      Runs
    </button>
  );
  if (run.status === "queued" || run.status === "running") {
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        {job} run {run.status === "queued" ? "queued" : `running since ${formatDateTime(run.startedAt!)}`}
        {run.job === "assess" && " (takes a few minutes)"}. You can leave this page; follow it in {research}.
      </p>
    );
  }
  if (run.status === "failed") {
    return (
      <p className="mt-2 text-sm text-destructive">
        Last {job.toLowerCase()} run failed: {run.error}
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm text-muted-foreground">
      Last {job.toLowerCase()} run {formatDateTime(run.finishedAt!)}: +{run.result?.evidenceAdded ?? 0} evidence. History in {research}.
    </p>
  );
}
