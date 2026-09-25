import type { Database } from "bun:sqlite";
import { getCompany } from "./db/queries";
import { activeRun, createRun, failRun, finishRun, getRun, startRun } from "./db/runs";
import type { Hypothesis, Run, RunResult, RunTarget, RunTrigger } from "./domain/types";
import { loadHypothesis, pullMonitor, runAgent, runSearch, startMonitor } from "./research";

export type Executor = (db: Database, run: Run) => Promise<RunResult>;

const assessed = (h: Hypothesis) => ({ confidence: h.confidence, status: h.status });

/** Does the research a run describes, through the same functions the backfill script uses. */
export const executeRun: Executor = async (db, run) => {
  if (run.kind === "monitor") {
    let company = getCompany(db, run.companyId);
    if (!company) throw new Error(`Unknown company ${run.companyId}`);
    if (!company.monitorId) {
      await startMonitor(db, company);
      company = getCompany(db, run.companyId)!;
    }
    return { evidenceAdded: (await pullMonitor(db, company)).length };
  }

  const t = loadHypothesis(db, run.companyId, run.hypothesisId!);
  if (!t) throw new Error(`Unknown hypothesis ${run.hypothesisId}`);
  if (run.kind === "search") return { evidenceAdded: (await runSearch(db, t.company, t.hypothesis)).length };

  const after = await runAgent(db, t.company, t.hypothesis);
  return {
    evidenceAdded: after.evidence.length - t.hypothesis.evidence.length,
    assessment: { before: assessed(t.hypothesis), after: assessed(after) },
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
    try {
      finishRun(db, id, await execute(db, getRun(db, id)!));
    } catch (e) {
      failRun(db, id, e instanceof Error ? e.message : String(e));
    }
  };

  return {
    /** Queues a run, or returns the one already queued or running for the same target. */
    enqueue(target: RunTarget & { trigger: RunTrigger; scheduleId?: string }): Run {
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
