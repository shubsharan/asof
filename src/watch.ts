import type { Database } from "bun:sqlite";
import { getCompany } from "./db/queries";
import { createSchedule, deleteSchedule, listSchedules, updateSchedule } from "./db/runs";
import { getWatch, markWatchActive, markWatchFailure, markWatchStarting, markWatchStopped, setWatchSchedule, watchCreationPayload } from "./db/watches";
import type { Company, Run, WatchState } from "./domain/types";
import type { Runner } from "./runner";

export type WatchProvider = {
  payload(company: Company): unknown;
  create(company: Company, options: { idempotencyKey: string; stablePayloadJson: string }): Promise<{ id: string }>;
  delete(monitorId: string): Promise<void>;
  get(monitorId: string): Promise<{
    status: "creating" | "pending_first_refresh" | "active";
    lastRefreshAt?: string | null;
    refresh: { state: "idle" } | { state: "running"; startedAt: string; entitiesProcessed: number; entitiesTotal: number };
  }>;
};

const tails = new Map<string, Promise<unknown>>();
const serialize = <T>(companyId: string, work: () => Promise<T>): Promise<T> => {
  const next = (tails.get(companyId) ?? Promise.resolve()).catch(() => {}).then(work);
  tails.set(companyId, next);
  return next;
};

function ensureCollectionSchedule(db: Database, companyId: string, now: string): string {
  const state = getWatch(db, companyId)!;
  const schedules = listSchedules(db, { companyId }).filter((schedule) => schedule.job === "watch");
  const selected = schedules.find((schedule) => schedule.id === state.collectionScheduleId) ?? schedules[0]
    ?? createSchedule(db, { job: "watch", companyId, everyHours: 1 }, now);
  updateSchedule(db, selected.id, { enabled: true, everyHours: 1 }, now);
  for (const duplicate of schedules) if (duplicate.id !== selected.id) deleteSchedule(db, duplicate.id);
  setWatchSchedule(db, companyId, selected.id, now);
  return selected.id;
}

export function startWatch(
  db: Database,
  runner: Runner,
  companyId: string,
  provider: WatchProvider,
  now = new Date().toISOString(),
): Promise<{ watch: WatchState; initialRun: Run }> {
  return serialize(companyId, async () => {
    const company = getCompany(db, companyId);
    let watch = getWatch(db, companyId);
    if (!company || !watch) throw new Error(`Unknown company ${companyId}`);

    let monitorId = watch.remoteMonitorId;
    if (!monitorId) {
      const payload = watchCreationPayload(db, companyId) ?? JSON.stringify(provider.payload(company));
      watch = markWatchStarting(db, companyId, payload, now);
      try {
        monitorId = (await provider.create(company, { idempotencyKey: watch.idempotencyKey, stablePayloadJson: payload })).id;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        markWatchFailure(db, companyId, message, now, "starting");
        throw cause;
      }
    }

    markWatchActive(db, companyId, monitorId, now);
    ensureCollectionSchedule(db, companyId, now);
    const initialRun = runner.enqueue({ job: "watch", companyId, trigger: "manual" });
    return { watch: getWatch(db, companyId)!, initialRun };
  });
}

export function stopWatch(
  db: Database,
  companyId: string,
  provider: WatchProvider,
  now = new Date().toISOString(),
): Promise<WatchState> {
  return serialize(companyId, async () => {
    const watch = getWatch(db, companyId);
    if (!watch) throw new Error(`Unknown company ${companyId}`);
    let monitorId = watch.remoteMonitorId;
    if (!monitorId && watchCreationPayload(db, companyId)) {
      const company = getCompany(db, companyId);
      const payload = watchCreationPayload(db, companyId);
      if (!company || !payload) throw new Error(`Watch creation for ${companyId} cannot yet be resolved`);
      try {
        monitorId = (await provider.create(company, { idempotencyKey: watch.idempotencyKey, stablePayloadJson: payload })).id;
        markWatchActive(db, companyId, monitorId, now);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        markWatchFailure(db, companyId, message, now, "stop-failed");
        throw cause;
      }
    }
    if (monitorId) {
      try {
        await provider.delete(monitorId);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        markWatchFailure(db, companyId, message, now, "stop-failed");
        throw cause;
      }
    }
    for (const schedule of listSchedules(db, { companyId }).filter((item) => item.job === "watch")) {
      updateSchedule(db, schedule.id, { enabled: false }, now);
    }
    return markWatchStopped(db, companyId, now);
  });
}

export async function inspectWatch(db: Database, companyId: string, provider: WatchProvider): Promise<WatchState | undefined> {
  const watch = getWatch(db, companyId);
  if (!watch?.remoteMonitorId) return watch;
  try {
    const remote = await provider.get(watch.remoteMonitorId);
    return {
      ...watch,
      remoteStatus: remote.status,
      remoteRefresh: remote.refresh,
      lastRemoteRefreshAt: remote.lastRefreshAt ?? undefined,
    };
  } catch (cause) {
    return {
      ...watch,
      remoteInspectionFailure: {
        at: new Date().toISOString(),
        message: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
}
