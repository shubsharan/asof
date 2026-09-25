import { exa } from "./client";

// Exa Snapshot keeps about 5 months of page history; older cutoffs are refused.
const SNAPSHOT_WINDOW_MS = 150 * 24 * 60 * 60 * 1000;

/**
 * A page as it was at the end of `asOf` (Exa Snapshot) and as it is now. `then` is null when Exa
 * has no stored version by that date, or the date is outside Snapshot's window.
 */
export async function pageThenAndNow(url: string, asOf: string) {
  const snapshotAsOf = `${asOf.slice(0, 10)}T23:59:59Z`;
  const [then, now] = await Promise.all([
    Date.parse(snapshotAsOf) > Date.now() - SNAPSHOT_WINDOW_MS
      ? exa.getContents([url], { snapshotAsOf, text: true })
      : undefined,
    exa.getContents([url], { text: true }),
  ]);
  return { then: then?.results[0] ?? null, now: now.results[0] ?? null };
}
