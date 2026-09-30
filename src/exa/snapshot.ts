import type { SearchResponse } from "exa-js";
import { exa } from "./client";
import { captureSources, isHttpUrl, type SourceCapture } from "./contents";

// Exa Snapshot keeps about 5 months of page history; older cutoffs are refused.
const SNAPSHOT_WINDOW_MS = 150 * 24 * 60 * 60 * 1000;

/**
 * A page as it was at the end of `asOf` (Exa Snapshot) and as it is now. Each side reports its
 * own retrieval gap, so an unavailable historical version does not hide current content.
 */
export type SnapshotCapture = SourceCapture;

type SnapshotResponse = SearchResponse<{ text: true }>;
type GetContents = (urls: string[], options: { text: true; filterEmptyResults: false; snapshotAsOf?: string; maxAgeHours?: number }) => Promise<SnapshotResponse>;

type SnapshotResult = { now: SnapshotCapture; then?: SnapshotCapture };

function snapshotCutoff(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (parsed.toISOString().slice(0, 10) === value) return `${value}T23:59:59Z`;
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) {
    return value;
  }
  throw new Error("Invalid snapshot cutoff");
}

export async function pageThenAndNow(
  url: string,
  asOf: string | undefined,
  getContents: GetContents = (urls, options) => exa.getContents(urls, options),
  now = () => new Date().toISOString(),
): Promise<SnapshotResult> {
  if (!isHttpUrl(url)) throw new Error("Invalid HTTP(S) URL");
  const snapshotAsOf = asOf === undefined ? undefined : snapshotCutoff(asOf);
  if (!snapshotAsOf) {
    const current = await captureSources([url], { maxAgeHours: 0, getContents, now });
    return { now: current.get(url)! };
  }
  const [then, current] = await Promise.all([
    Date.parse(snapshotAsOf) > Date.now() - SNAPSHOT_WINDOW_MS
      ? captureSources([url], { snapshotAsOf, getContents, now }).then((captures) => captures.get(url)!)
      : Promise.resolve<SnapshotCapture>({ status: "unavailable", url, retrievedAt: now(), error: "Historical snapshot is outside Exa's retention window" }),
    captureSources([url], { maxAgeHours: 0, getContents, now }).then((captures) => captures.get(url)!),
  ]);
  return { then, now: current };
}
