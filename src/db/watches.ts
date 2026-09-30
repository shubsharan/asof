import type { Database } from "bun:sqlite";
import type { WatchState, WatchStatus } from "../domain/types";

type WatchRow = {
  company_id: string;
  status: WatchStatus;
  monitor_id: string | null;
  idempotency_key: string;
  creation_payload: string | null;
  collection_schedule_id: string | null;
  last_collected_at: string | null;
  latest_failure_at: string | null;
  latest_failure_message: string | null;
};

const toWatch = (row: WatchRow): WatchState => ({
  companyId: row.company_id,
  status: row.status,
  remoteMonitorId: row.monitor_id ?? undefined,
  idempotencyKey: row.idempotency_key,
  collectionScheduleId: row.collection_schedule_id ?? undefined,
  lastCollectedAt: row.last_collected_at ?? undefined,
  latestFailure: row.latest_failure_at && row.latest_failure_message
    ? { at: row.latest_failure_at, message: row.latest_failure_message }
    : undefined,
});

export function getWatch(db: Database, companyId: string): WatchState | undefined {
  if (!db.query("SELECT 1 FROM companies WHERE id = ?").get(companyId)) return undefined;
  db.query(`INSERT OR IGNORE INTO company_watches
    (company_id, status, idempotency_key, updated_at) VALUES (?, 'stopped', ?, ?)`)
    .run(companyId, crypto.randomUUID(), new Date().toISOString());
  return toWatch(db.query<WatchRow, [string]>("SELECT * FROM company_watches WHERE company_id = ?").get(companyId)!);
}

export function watchCreationPayload(db: Database, companyId: string): string | undefined {
  return db.query<{ creation_payload: string | null }, [string]>("SELECT creation_payload FROM company_watches WHERE company_id = ?").get(companyId)?.creation_payload ?? undefined;
}

export function markWatchStarting(db: Database, companyId: string, payload: string, now: string): WatchState {
  if (!getWatch(db, companyId)) throw new Error(`Unknown company ${companyId}`);
  db.query(`UPDATE company_watches SET status = 'starting', creation_payload = coalesce(creation_payload, ?),
    latest_failure_at = NULL, latest_failure_message = NULL, updated_at = ? WHERE company_id = ?`).run(payload, now, companyId);
  return getWatch(db, companyId)!;
}

export function markWatchActive(db: Database, companyId: string, monitorId: string, now: string): WatchState {
  if (!getWatch(db, companyId)) throw new Error(`Unknown company ${companyId}`);
  db.query(`UPDATE company_watches SET status = 'watching', monitor_id = ?, latest_failure_at = NULL,
    latest_failure_message = NULL, updated_at = ? WHERE company_id = ?`).run(monitorId, now, companyId);
  return getWatch(db, companyId)!;
}

export function setWatchSchedule(db: Database, companyId: string, scheduleId: string, now: string): WatchState {
  db.query("UPDATE company_watches SET collection_schedule_id = ?, updated_at = ? WHERE company_id = ?").run(scheduleId, now, companyId);
  return getWatch(db, companyId)!;
}

export function markWatchCollected(db: Database, companyId: string, now: string): void {
  db.query(`UPDATE company_watches SET last_collected_at = ?,
    latest_failure_at = CASE WHEN status = 'stop-failed' THEN latest_failure_at ELSE NULL END,
    latest_failure_message = CASE WHEN status = 'stop-failed' THEN latest_failure_message ELSE NULL END,
    updated_at = ? WHERE company_id = ?`).run(now, now, companyId);
}

export function markWatchFailure(db: Database, companyId: string, message: string, now: string, status?: WatchStatus): void {
  db.query(`UPDATE company_watches SET status = coalesce(?, status), latest_failure_at = ?,
    latest_failure_message = ?, updated_at = ? WHERE company_id = ?`).run(status ?? null, now, message, now, companyId);
}

export function markWatchStopped(db: Database, companyId: string, now: string): WatchState {
  db.query(`UPDATE company_watches SET status = 'stopped', monitor_id = NULL, creation_payload = NULL,
    idempotency_key = ?, collection_schedule_id = NULL, latest_failure_at = NULL,
    latest_failure_message = NULL, updated_at = ? WHERE company_id = ?`).run(crypto.randomUUID(), now, companyId);
  return getWatch(db, companyId)!;
}
