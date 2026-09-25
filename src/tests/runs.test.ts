import { test, expect } from "bun:test";
import { createDb } from "../db/schema";
import { createHypothesis } from "../db/queries";
import { createRun, createSchedule, getRun, listRuns, listSchedules, recoverRuns, startRun, updateSchedule } from "../db/runs";
import type { RunResult } from "../domain/types";
import { createRunner, type Executor } from "../runner";
import { tick } from "../scheduler";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme Security', 'Security software', 'acme.example')");
  createHypothesis(db, { id: "adoption", companyId: "acme", lens: "adoption", statement: "Enterprise adoption is accelerating" });
  createHypothesis(db, { id: "moat", companyId: "acme", lens: "moat", statement: "Moat is strengthening" });
  return db;
}

const search = (hypothesisId = "adoption") => ({ kind: "search" as const, companyId: "acme", hypothesisId, trigger: "manual" as const });

/** An executor whose runs finish only when the test says so. */
function controlled() {
  const pending: { id: string; resolve: (r: RunResult) => void; reject: (e: Error) => void }[] = [];
  const execute: Executor = (_db, run) => new Promise((resolve, reject) => pending.push({ id: run.id, resolve, reject }));
  return { execute, pending };
}

test("a run moves from queued to running to done and records its result", async () => {
  const db = setup();
  const { execute, pending } = controlled();
  const runner = createRunner(db, execute);

  const run = runner.enqueue(search());
  expect(run.status).toBe("running");
  pending[0]!.resolve({ evidenceAdded: 3 });
  await runner.idle();

  expect(getRun(db, run.id)).toMatchObject({ status: "done", result: { evidenceAdded: 3 } });
  expect(getRun(db, run.id)!.finishedAt).toBeDefined();
});

test("a failing run records its error and the queue keeps going", async () => {
  const db = setup();
  let calls = 0;
  const runner = createRunner(db, async () => {
    if (calls++ === 0) throw new Error("Exa is down");
    return { evidenceAdded: 1 };
  }, 1);

  const a = runner.enqueue(search("adoption"));
  const b = runner.enqueue(search("moat"));
  await runner.idle();

  expect(getRun(db, a.id)).toMatchObject({ status: "failed", error: "Exa is down" });
  expect(getRun(db, b.id)).toMatchObject({ status: "done" });
});

test("enqueueing the same target twice returns the run already in progress", async () => {
  const db = setup();
  const { execute, pending } = controlled();
  const runner = createRunner(db, execute);

  const first = runner.enqueue(search());
  const again = runner.enqueue({ ...search(), trigger: "schedule" });
  expect(again.id).toBe(first.id);
  expect(runner.enqueue({ ...search(), kind: "agent" }).id).not.toBe(first.id);

  pending.forEach((p) => p.resolve({ evidenceAdded: 0 }));
  await runner.idle();
  expect(runner.enqueue(search()).id).not.toBe(first.id); // finished runs don't block new ones
});

test("no more than `concurrency` runs execute at once", async () => {
  const db = setup();
  const { execute, pending } = controlled();
  const runner = createRunner(db, execute, 2);

  const runs = [
    runner.enqueue(search("adoption")),
    runner.enqueue({ ...search("adoption"), kind: "agent" }),
    runner.enqueue(search("moat")),
  ];
  expect(pending).toHaveLength(2);
  expect(getRun(db, runs[2]!.id)!.status).toBe("queued");

  pending[0]!.resolve({ evidenceAdded: 0 });
  await Bun.sleep(0);
  expect(pending).toHaveLength(3);
  pending.slice(1).forEach((p) => p.resolve({ evidenceAdded: 0 }));
  await runner.idle();
  expect(listRuns(db).every((r) => r.status === "done")).toBe(true);
});

test("runs target a hypothesis, except monitor runs which target the company", () => {
  const db = setup();
  expect(() => createRun(db, { kind: "search", companyId: "acme", trigger: "manual" })).toThrow(/needs a hypothesis/);
  expect(() => createRun(db, { kind: "monitor", companyId: "acme", hypothesisId: "adoption", trigger: "manual" })).toThrow(/company/);
  expect(createRun(db, { kind: "monitor", companyId: "acme", trigger: "manual" }).status).toBe("queued");
});

test("after a restart, interrupted runs fail and queued runs are picked up again", async () => {
  const db = setup();
  const interrupted = createRun(db, search("adoption"));
  startRun(db, interrupted.id);
  const waiting = createRun(db, search("moat"));

  const queued = recoverRuns(db);
  expect(queued.map((r) => r.id)).toEqual([waiting.id]);
  expect(getRun(db, interrupted.id)).toMatchObject({ status: "failed", error: "Interrupted by server restart" });

  const runner = createRunner(db, async () => ({ evidenceAdded: 2 }));
  runner.resume(queued);
  await runner.idle();
  expect(getRun(db, waiting.id)!.status).toBe("done");
});

test("the scheduler queues due, enabled schedules once and advances them", async () => {
  const db = setup();
  const daily = createSchedule(db, { kind: "search", companyId: "acme", hypothesisId: "adoption", everyHours: 24 }, "2026-09-01T00:00:00.000Z");
  const paused = createSchedule(db, { kind: "monitor", companyId: "acme", everyHours: 1 }, "2026-09-01T00:00:00.000Z");
  updateSchedule(db, paused.id, { enabled: false });
  const runner = createRunner(db, async () => ({ evidenceAdded: 0 }));

  expect(tick(db, runner, "2026-09-01T12:00:00.000Z")).toHaveLength(0); // not due yet

  // Due many times over while the app was down: fires once.
  expect(tick(db, runner, "2026-09-10T09:00:00.000Z").map((s) => s.id)).toEqual([daily.id]);
  expect(tick(db, runner, "2026-09-10T09:01:00.000Z")).toHaveLength(0);
  await runner.idle();

  expect(listRuns(db)).toHaveLength(1);
  expect(listRuns(db)[0]).toMatchObject({ trigger: "schedule", scheduleId: daily.id, hypothesisId: "adoption" });
  expect(listSchedules(db).find((s) => s.id === daily.id)!.nextRunAt).toBe("2026-09-11T09:00:00.000Z");
});
