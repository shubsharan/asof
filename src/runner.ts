import type { Database } from "bun:sqlite";
import { getCompany } from "./db/queries";
import { activeRun, createRun, failRun, finishRun, getRun, startRun } from "./db/runs";
import { getWatch, markWatchCollected, markWatchFailure } from "./db/watches";
import type { Run, RunResult, RunTarget, RunTrigger } from "./domain/types";
import { loadHypothesis, runAssess, runResearch, runWatch } from "./research";

export type Executor = (db: Database, run: Run) => Promise<RunResult>;

/** Does the job a run describes, through the same functions the backfill script uses. */
export const executeRun: Executor = async (db, run) => {
  if (run.job === "watch") {
    const company = getCompany(db, run.companyId);
    if (!company) throw new Error(`Unknown company ${run.companyId}`);
    const added = await runWatch(db, company);
    return { evidenceAdded: added.length, evidenceIds: added.map((e) => e.id) };
  }

  const t = loadHypothesis(db, run.companyId, run.hypothesisId!);
  if (!t) throw new Error(`Unknown hypothesis ${run.hypothesisId}`);
  if (run.job === "research") {
    const added = await runResearch(db, t.company, t.hypothesis);
    return { evidenceAdded: added.length, evidenceIds: added.map((e) => e.id) };
  }

  const assessment = await runAssess(db, t.company, t.hypothesis);
  return {
    evidenceAdded: assessment.addedEvidenceIds.length,
    evidenceIds: assessment.addedEvidenceIds,
    assessmentId: assessment.id,
  };
};

export type Runner = ReturnType<typeof createRunner>;

/**
 * An in-process queue of research runs. Runs are recorded in the database as they move through
 * queued → running → done/failed, so the UI can follow them without holding a request open.
 */
export function createRunner(db: Database, execute: Executor = executeRun, concurrency = 2) {
  const queue: string[] = [];
  let running = 0;
  let onIdle: (() => void)[] = [];

  const pump = () => {
    while (running < concurrency && queue.length) {
      const id = queue.shift()!;
      running++;
      runOne(id).finally(() => {
        running--;
        pump();
      });
    }
    if (!running && !queue.length) {
      onIdle.forEach((resolve) => resolve());
      onIdle = [];
    }
  };

  const runOne = async (id: string) => {
    startRun(db, id);
    const run = getRun(db, id)!;
    try {
      const result = await execute(db, run);
      const now = new Date().toISOString();
      if (run.job === "watch") markWatchCollected(db, run.companyId, now);
      finishRun(db, id, result, now);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const now = new Date().toISOString();
      if (run.job === "watch") markWatchFailure(db, run.companyId, message, now);
      failRun(db, id, message, now);
    }
  };

  return {
    /** Queues a run, or returns the one already queued or running for the same target. */
    enqueue(target: RunTarget & { trigger: RunTrigger; scheduleId?: string }): Run {
      if (target.job === "watch") {
        const watch = getWatch(db, target.companyId);
        if (!watch?.remoteMonitorId || (watch.status !== "watching" && watch.status !== "stop-failed")) throw new Error(`Company ${target.companyId} is not being watched`);
      }
      const existing = activeRun(db, target);
      if (existing) return existing;
      const run = createRun(db, target);
      queue.push(run.id);
      pump();
      return getRun(db, run.id)!;
    },
    /** Picks up runs that were queued before a restart. */
    resume(runs: Run[]) {
      queue.push(...runs.map((r) => r.id));
      pump();
    },
    /** Resolves once nothing is queued or running. */
    idle(): Promise<void> {
      return running || queue.length ? new Promise((resolve) => onIdle.push(resolve)) : Promise.resolve();
    },
  };
}
