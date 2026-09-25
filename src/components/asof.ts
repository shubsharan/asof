import { useCallback, useSyncExternalStore } from "react";
import { todayUTC } from "@/domain/timeline";

// The as-of date lives in the URL (`?asOf=YYYY-MM-DD`) so links and reloads keep it, and pages read
// it through this hook so a scrub re-renders them without a page load. Nothing is stored in module
// scope: the URL is the state, a DOM event is the change signal (same pattern as the runs bus).

const EVENT = "asof:asof";

const read = () => new URLSearchParams(location.search).get("asOf") ?? undefined;

const subscribe = (onChange: () => void) => {
  document.addEventListener(EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    document.removeEventListener(EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
};

/** Today and later mean "now": no rewind. */
export const normalizeAsOf = (date: string | undefined, today = todayUTC()) => (date && date < today ? date : undefined);

/** Rewrites `?asOf=` in place and tells every subscriber. Call on commit (release, click, key), not per pointer move. */
export function setAsOf(date: string | undefined): void {
  const url = new URL(location.href);
  const next = normalizeAsOf(date);
  if (next) url.searchParams.set("asOf", next);
  else url.searchParams.delete("asOf");
  history.replaceState(history.state, "", url);
  document.dispatchEvent(new Event(EVENT));
}

export function useAsOf() {
  const asOf = useSyncExternalStore(subscribe, read, read);
  return { asOf, setAsOf: useCallback(setAsOf, []), today: todayUTC() };
}
