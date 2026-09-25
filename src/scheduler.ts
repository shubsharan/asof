import type { Database } from "bun:sqlite";
import { advanceSchedule, dueSchedules } from "./db/runs";
import type { Runner } from "./runner";

/**
 * Queues a run for every enabled schedule that is due. A schedule that was due several times
 * while the app was down fires once, then waits a full interval.
 */
export function tick(db: Database, runner: Pick<Runner, "enqueue">, now = new Date().toISOString()) {
  const due = dueSchedules(db, now);
  for (const s of due) {
    runner.enqueue({ job: s.job, companyId: s.companyId, hypothesisId: s.hypothesisId, trigger: "schedule", scheduleId: s.id });
    advanceSchedule(db, s, now);
  }
  return due;
}

/** Ticks now and every minute after, inside the server process. Returns a stop function. */
export function startScheduler(db: Database, runner: Pick<Runner, "enqueue">, everyMs = 60_000) {
  const check = () => {
    try {
      tick(db, runner);
    } catch (e) {
      console.error("Scheduler tick failed", e);
    }
  };
  check();
  const timer = setInterval(check, everyMs);
  return () => clearInterval(timer);
}
