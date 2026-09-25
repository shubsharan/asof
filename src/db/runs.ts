import type { Database } from "bun:sqlite";
import type { Run, RunResult, RunTarget, RunTrigger, Schedule } from "../domain/types";

type RunRow = {
  id: string;
  kind: Run["kind"];
  company_id: string;
  hypothesis_id: string | null;
  trigger: RunTrigger;
  schedule_id: string | null;
  status: Run["status"];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: string | null;
};

type ScheduleRow = {
  id: string;
  kind: Schedule["kind"];
  company_id: string;
  hypothesis_id: string | null;
  every_hours: number;
  enabled: number;
  next_run_at: string;
  created_at: string;
};

const toRun = (r: RunRow): Run => ({
  id: r.id,
  kind: r.kind,
  companyId: r.company_id,
  hypothesisId: r.hypothesis_id ?? undefined,
  trigger: r.trigger,
  scheduleId: r.schedule_id ?? undefined,
  status: r.status,
  createdAt: r.created_at,
  startedAt: r.started_at ?? undefined,
  finishedAt: r.finished_at ?? undefined,
  error: r.error ?? undefined,
  result: r.result ? JSON.parse(r.result) : undefined,
});

const toSchedule = (r: ScheduleRow): Schedule => ({
  id: r.id,
  kind: r.kind,
  companyId: r.company_id,
  hypothesisId: r.hypothesis_id ?? undefined,
  everyHours: r.every_hours,
  enabled: r.enabled === 1,
  nextRunAt: r.next_run_at,
  createdAt: r.created_at,
});

/** Search and agent runs target a hypothesis; monitor runs target the whole company. */
export function checkTarget(t: RunTarget): void {
  if (!["search", "agent", "monitor"].includes(t.kind)) throw new Error(`Unknown run kind ${t.kind}`);
  if (t.kind === "monitor" ? t.hypothesisId : !t.hypothesisId) {
    throw new Error(t.kind === "monitor" ? "Monitor runs target a company, not a hypothesis" : `A ${t.kind} run needs a hypothesis`);
  }
}

const hours = (n: number) => n * 60 * 60 * 1000;
const later = (iso: string, h: number) => new Date(Date.parse(iso) + hours(h)).toISOString();

// ---- Runs ----

export function createRun(
  db: Database,
  target: RunTarget & { trigger: RunTrigger; scheduleId?: string },
  now = new Date().toISOString(),
): Run {
  checkTarget(target);
  const row = db
    .query<RunRow, Record<string, string | null>>(
      `INSERT INTO runs (id, kind, company_id, hypothesis_id, trigger, schedule_id, status, created_at)
       VALUES ($id, $kind, $companyId, $hypothesisId, $trigger, $scheduleId, 'queued', $now) RETURNING *`,
    )
    .get({
      id: crypto.randomUUID(),
      kind: target.kind,
      companyId: target.companyId,
      hypothesisId: target.hypothesisId ?? null,
      trigger: target.trigger,
      scheduleId: target.scheduleId ?? null,
      now,
    })!;
  return toRun(row);
}

export function getRun(db: Database, id: string): Run | undefined {
  const row = db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
  return row ? toRun(row) : undefined;
}

export function startRun(db: Database, id: string, now = new Date().toISOString()): void {
  db.query("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?").run(now, id);
}

export function finishRun(db: Database, id: string, result: RunResult, now = new Date().toISOString()): void {
  db.query("UPDATE runs SET status = 'done', finished_at = ?, result = ? WHERE id = ?").run(now, JSON.stringify(result), id);
}

export function failRun(db: Database, id: string, error: string, now = new Date().toISOString()): void {
  db.query("UPDATE runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(now, error, id);
}

/** A queued or running run for the same kind and target, if there is one. */
export function activeRun(db: Database, t: RunTarget): Run | undefined {
  const row = db
    .query<RunRow, [string, string, string | null]>(
      `SELECT * FROM runs WHERE status IN ('queued', 'running')
       AND kind = ? AND company_id = ? AND hypothesis_id IS ? ORDER BY created_at LIMIT 1`,
    )
    .get(t.kind, t.companyId, t.hypothesisId ?? null);
  return row ? toRun(row) : undefined;
}

export type RunFilter = { companyId?: string; hypothesisId?: string; active?: boolean; failed?: boolean; limit?: number };

/** Newest first. */
export function listRuns(db: Database, f: RunFilter = {}): Run[] {
  const where = ["1 = 1"];
  if (f.companyId) where.push("company_id = $companyId");
  if (f.hypothesisId) where.push("hypothesis_id = $hypothesisId");
  if (f.active) where.push("status IN ('queued', 'running')");
  if (f.failed) where.push("status = 'failed'");
  return db
    .query<RunRow, Record<string, string | number>>(
      `SELECT * FROM runs WHERE ${where.join(" AND ")} ORDER BY created_at DESC, rowid DESC LIMIT $limit`,
    )
    .all({
      ...(f.companyId && { companyId: f.companyId }),
      ...(f.hypothesisId && { hypothesisId: f.hypothesisId }),
      limit: f.limit ?? 100,
    })
    .map(toRun);
}

/**
 * After a restart: runs that were mid-flight can't be resumed, so they fail; queued ones are
 * returned oldest first to be picked up again.
 */
export function recoverRuns(db: Database, now = new Date().toISOString()): Run[] {
  db.query("UPDATE runs SET status = 'failed', finished_at = ?, error = 'Interrupted by server restart' WHERE status = 'running'").run(now);
  return db.query<RunRow, []>("SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at, rowid").all().map(toRun);
}

// ---- Schedules ----

/** The first run is due one interval from now. */
export function createSchedule(
  db: Database,
  s: RunTarget & { everyHours: number },
  now = new Date().toISOString(),
): Schedule {
  checkTarget(s);
  if (!(s.everyHours > 0)) throw new Error("A schedule needs a positive interval");
  const row = db
    .query<ScheduleRow, Record<string, string | number | null>>(
      `INSERT INTO schedules (id, kind, company_id, hypothesis_id, every_hours, enabled, next_run_at, created_at)
       VALUES ($id, $kind, $companyId, $hypothesisId, $everyHours, 1, $next, $now) RETURNING *`,
    )
    .get({
      id: crypto.randomUUID(),
      kind: s.kind,
      companyId: s.companyId,
      hypothesisId: s.hypothesisId ?? null,
      everyHours: s.everyHours,
      next: later(now, s.everyHours),
      now,
    })!;
  return toSchedule(row);
}

/** Changing the interval restarts the countdown from now. */
export function updateSchedule(
  db: Database,
  id: string,
  change: { enabled?: boolean; everyHours?: number },
  now = new Date().toISOString(),
): Schedule | undefined {
  if (change.enabled !== undefined) db.query("UPDATE schedules SET enabled = ? WHERE id = ?").run(change.enabled ? 1 : 0, id);
  if (change.everyHours !== undefined) {
    if (!(change.everyHours > 0)) throw new Error("A schedule needs a positive interval");
    db.query("UPDATE schedules SET every_hours = ?, next_run_at = ? WHERE id = ?").run(change.everyHours, later(now, change.everyHours), id);
  }
  const row = db.query<ScheduleRow, [string]>("SELECT * FROM schedules WHERE id = ?").get(id);
  return row ? toSchedule(row) : undefined;
}

export function deleteSchedule(db: Database, id: string): boolean {
  return db.query("DELETE FROM schedules WHERE id = ?").run(id).changes > 0;
}

export function listSchedules(db: Database, f: { companyId?: string } = {}): Schedule[] {
  return (
    f.companyId
      ? db.query<ScheduleRow, [string]>("SELECT * FROM schedules WHERE company_id = ? ORDER BY created_at").all(f.companyId)
      : db.query<ScheduleRow, []>("SELECT * FROM schedules ORDER BY created_at").all()
  ).map(toSchedule);
}

export function dueSchedules(db: Database, now = new Date().toISOString()): Schedule[] {
  return db
    .query<ScheduleRow, [string]>("SELECT * FROM schedules WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at")
    .all(now)
    .map(toSchedule);
}

/** Next due one interval after `now`, however many intervals were missed. */
export function advanceSchedule(db: Database, s: Schedule, now = new Date().toISOString()): void {
  db.query("UPDATE schedules SET next_run_at = ? WHERE id = ?").run(later(now, s.everyHours), s.id);
}
