import { useCallback, useSyncExternalStore } from "react";
import { todayUTC } from "@/domain/timeline";
import { parseRoute, supportsHistory } from "./routes";
import type { HistoryMode } from "@/domain/research";

// The as-of date lives in the URL (`?asOf=YYYY-MM-DD`) so links and reloads keep it, and pages read
// it through this hook so a scrub re-renders them without a page load. A DOM event is the change
// signal (same pattern as the runs bus). While the date moves fast (a drag, a held arrow key) the URL
// trails it: browsers throttle history.replaceState, so the newest date waits in `pending` and pages
// read that first.

const EVENT = "asof:asof";
const URL_DELAY_MS = 250;

let pending: { asOf: string | undefined } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const fromUrl = () => new URLSearchParams(location.search).get("asOf") ?? undefined;
const read = () => supportsHistory(parseRoute(location.pathname)) ? normalizeAsOf(pending ? pending.asOf : fromUrl()) : undefined;
const readMode = (): HistoryMode => supportsHistory(parseRoute(location.pathname)) && new URLSearchParams(location.search).get("history") === "reconstruction" ? "reconstruction" : "recorded";
const readAssessmentId = () => {
  if (pending || !supportsHistory(parseRoute(location.pathname))) return undefined;
  const value = new URLSearchParams(location.search).get("assessmentId");
  const id = value === null ? NaN : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

function writeUrl() {
  if (!pending) return;
  const url = new URL(location.href);
  if (pending.asOf) url.searchParams.set("asOf", pending.asOf);
  else url.searchParams.delete("asOf");
  url.searchParams.delete("assessmentId");
  pending = null;
  history.replaceState(history.state, "", url);
}
addEventListener("pagehide", writeUrl);

const subscribe = (onChange: () => void) => {
  const onPop = () => {
    pending = null;
    clearTimeout(timer);
    onChange();
  };
  document.addEventListener(EVENT, onChange);
  window.addEventListener("popstate", onPop);
  return () => {
    document.removeEventListener(EVENT, onChange);
    window.removeEventListener("popstate", onPop);
  };
};

/** Date-only today means now; an exact saved timestamp can select a decision made today. */
export const normalizeAsOf = (date: string | undefined, today = todayUTC()) => {
  if (!date || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/.test(date)) return undefined;
  const time = Date.parse(date);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date.slice(0, 10)) return undefined;
  return date.length === 10 ? (date < today ? date : undefined) : (time <= Date.now() ? new Date(time).toISOString() : undefined);
};

/** Moves every page to `date` now and rewrites `?asOf=` once it settles. Safe to call per pointer move. */
export function setAsOf(date: string | undefined): void {
  const next = normalizeAsOf(date);
  if (next === read() && readAssessmentId() === undefined) return;
  pending = { asOf: next };
  clearTimeout(timer);
  timer = setTimeout(writeUrl, URL_DELAY_MS);
  document.dispatchEvent(new Event(EVENT));
}

export function setMode(mode: HistoryMode): void {
  clearTimeout(timer);
  pending = null;
  const url = new URL(location.href);
  url.searchParams.set("history", mode);
  url.searchParams.delete("asOf");
  url.searchParams.delete("assessmentId");
  history.replaceState(history.state, "", url);
  document.dispatchEvent(new Event(EVENT));
}

export function setAssessmentId(id: number | undefined): void {
  writeUrl();
  const url = new URL(location.href);
  if (id !== undefined) url.searchParams.set("assessmentId", String(id));
  else url.searchParams.delete("assessmentId");
  history.replaceState(history.state, "", url);
  document.dispatchEvent(new Event(EVENT));
}

export function useAsOf() {
  const asOf = useSyncExternalStore(subscribe, read, read);
  const mode = useSyncExternalStore(subscribe, readMode, readMode);
  const assessmentId = useSyncExternalStore(subscribe, readAssessmentId, readAssessmentId);
  return { asOf, setAsOf: useCallback(setAsOf, []), mode, setMode: useCallback(setMode, []),
    assessmentId, setAssessmentId: useCallback(setAssessmentId, []), today: todayUTC() };
}
