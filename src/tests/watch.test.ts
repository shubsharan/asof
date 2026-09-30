import { expect, test } from "bun:test";
import { createDb } from "../db/schema";
import { getCompany } from "../db/queries";
import { createRun, createSchedule, getRun, listSchedules } from "../db/runs";
import { getWatch, markWatchActive, markWatchStarting } from "../db/watches";
import { createRunner } from "../runner";
import { inspectWatch, startWatch, stopWatch, type WatchProvider } from "../watch";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme', 'Tools', 'acme.example')");
  return db;
}

function provider() {
  const creates: { key: string; payload: string }[] = [];
  const deleted: string[] = [];
  let createFailure: Error | undefined;
  let deleteFailure: Error | undefined;
  const value: WatchProvider = {
    payload: () => ({ cadence: "1d", company: "Acme" }),
    create: async (_company, options) => {
      creates.push({ key: options.idempotencyKey, payload: options.stablePayloadJson });
      if (createFailure) throw createFailure;
      return { id: "monitor-1" };
    },
    delete: async (id) => {
      if (deleteFailure) throw deleteFailure;
      deleted.push(id);
    },
    get: async () => ({
      status: "pending_first_refresh",
      lastRefreshAt: null,
      refresh: { state: "running", startedAt: "2026-09-28T12:00:00Z", entitiesProcessed: 1, entitiesTotal: 2 },
    }),
  };
  return {
    value, creates, deleted,
    failCreate(error?: Error) { createFailure = error; },
    failDelete(error?: Error) { deleteFailure = error; },
  };
}

test("an ambiguous start retries the persisted key and payload and creates one hourly collector", async () => {
  const db = setup();
  const remote = provider();
  const runner = createRunner(db, async () => ({ evidenceAdded: 0, evidenceIds: [] }));
  remote.failCreate(new Error("connection lost"));
  await expect(startWatch(db, runner, "acme", remote.value, "2026-09-28T10:00:00Z")).rejects.toThrow("connection lost");
  const uncertain = getWatch(db, "acme")!;
  remote.failCreate();
  const started = await startWatch(db, runner, "acme", remote.value, "2026-09-28T10:01:00Z");
  await runner.idle();

  expect(remote.creates).toHaveLength(2);
  expect(remote.creates[1]).toEqual(remote.creates[0]);
  expect(started.watch).toMatchObject({ status: "watching", remoteMonitorId: "monitor-1", idempotencyKey: uncertain.idempotencyKey });
  expect(getRun(db, started.initialRun.id)?.status).toBe("done");
  expect(listSchedules(db, { companyId: "acme" })).toMatchObject([{ job: "watch", enabled: true, everyHours: 1 }]);
});

test("direct schedule creation reuses the company's single watch schedule", () => {
  const db = setup();
  markWatchActive(db, "acme", "monitor-1", "2026-09-28T09:00:00Z");
  const first = createSchedule(db, { job: "watch", companyId: "acme", everyHours: 4 }, "2026-09-28T10:00:00Z");
  const second = createSchedule(db, { job: "watch", companyId: "acme", everyHours: 8 }, "2026-09-28T11:00:00Z");
  expect(second.id).toBe(first.id);
  expect(listSchedules(db, { companyId: "acme" })).toMatchObject([{ everyHours: 1, enabled: true }]);
});

test("stop retries remote deletion, preserves failure, then disables every collector", async () => {
  const db = setup();
  const remote = provider();
  const runner = createRunner(db, async () => ({ evidenceAdded: 0, evidenceIds: [] }));
  await startWatch(db, runner, "acme", remote.value);
  await runner.idle();
  db.run(`INSERT INTO schedules (id, job, company_id, every_hours, enabled, next_run_at, created_at)
    VALUES ('duplicate', 'watch', 'acme', 1, 1, '2030-01-01', '2026-01-01')`);
  remote.failDelete(new Error("provider unavailable"));
  await expect(stopWatch(db, "acme", remote.value)).rejects.toThrow("provider unavailable");
  expect(getWatch(db, "acme")).toMatchObject({ status: "stop-failed", remoteMonitorId: "monitor-1", latestFailure: { message: "provider unavailable" } });

  remote.failDelete();
  const stopped = await stopWatch(db, "acme", remote.value);
  expect(stopped.status).toBe("stopped");
  expect(remote.deleted).toEqual(["monitor-1"]);
  expect(listSchedules(db, { companyId: "acme" }).every((item) => !item.enabled)).toBe(true);
});

test("stop resolves an uncertain create on every retry before claiming stopped", async () => {
  const db = setup();
  const remote = provider();
  markWatchStarting(db, "acme", JSON.stringify({ stable: true }), "2026-09-28T10:00:00Z");
  remote.failCreate(new Error("still ambiguous"));
  await expect(stopWatch(db, "acme", remote.value)).rejects.toThrow("still ambiguous");
  expect(getWatch(db, "acme")?.status).toBe("stop-failed");
  remote.failCreate();
  expect((await stopWatch(db, "acme", remote.value)).status).toBe("stopped");
  expect(remote.creates[1]).toEqual(remote.creates[0]);
  expect(remote.deleted).toEqual(["monitor-1"]);
});

test("inspection exposes native remote state and a visible inspection failure", async () => {
  const db = setup();
  const remote = provider();
  const runner = createRunner(db, async () => ({ evidenceAdded: 0, evidenceIds: [] }));
  await startWatch(db, runner, "acme", remote.value);
  await runner.idle();
  expect(await inspectWatch(db, "acme", remote.value)).toMatchObject({
    remoteStatus: "pending_first_refresh",
    remoteRefresh: { state: "running", entitiesProcessed: 1 },
  });
  remote.value.get = async () => { throw new Error("read failed"); };
  expect(await inspectWatch(db, "acme", remote.value)).toMatchObject({ remoteInspectionFailure: { message: "read failed" } });
});

test("a queued collection resumed after stop fails without recreating a monitor", async () => {
  const db = setup();
  const remote = provider();
  markWatchActive(db, "acme", "monitor-1", "2026-09-28T10:00:00Z");
  const queued = createRun(db, { job: "watch", companyId: "acme", trigger: "manual" });
  await stopWatch(db, "acme", remote.value);
  const runner = createRunner(db);
  runner.resume([queued]);
  await runner.idle();
  expect(getRun(db, queued.id)).toMatchObject({ status: "failed", error: "Company acme is not being watched" });
  expect(remote.creates).toHaveLength(0);
});

test("collection failures are visible and watch schedules cannot be enabled while stopped", async () => {
  const db = setup();
  expect(() => createSchedule(db, { job: "watch", companyId: "acme", everyHours: 1 })).toThrow(/not being watched/);
  markWatchActive(db, "acme", "monitor-1", "2026-09-28T10:00:00Z");
  const runner = createRunner(db, async () => { throw new Error("collection failed"); });
  const run = runner.enqueue({ job: "watch", companyId: "acme", trigger: "manual" });
  await runner.idle();
  expect(getRun(db, run.id)?.status).toBe("failed");
  expect(getWatch(db, "acme")?.latestFailure?.message).toBe("collection failed");
});

test("legacy company monitor IDs are ignored after runtime watch state exists", async () => {
  const db = setup();
  db.run("UPDATE companies SET monitor_id = 'legacy-monitor' WHERE id = 'acme'");
  const remote = provider();
  markWatchActive(db, "acme", "runtime-monitor", "2026-09-28T10:00:00Z");
  expect(getCompany(db, "acme")?.monitorId).toBe("runtime-monitor");
  await stopWatch(db, "acme", remote.value);
  expect(getCompany(db, "acme")?.monitorId).toBeUndefined();
});
