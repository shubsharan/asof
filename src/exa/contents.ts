import type { SearchResponse } from "exa-js";
import { normalizeSourceUrl } from "../domain/source";
import { exa, withRateLimitRetry } from "./client";

export { normalizeSourceUrl } from "../domain/source";

export type SourceCapture =
  | { status: "retrieved"; url: string; text: string; retrievedAt: string; snapshotAt?: string; excerpt?: string; grounding?: unknown }
  | { status: "unavailable"; url: string; retrievedAt: string; error: string; grounding?: unknown };

type ContentsResponse = SearchResponse<{ text: true }>;
type GetContents = (urls: string[], options: { text: true; filterEmptyResults: false; snapshotAsOf?: string; maxAgeHours?: number }) => Promise<ContentsResponse>;

type CaptureOptions = {
  getContents?: GetContents;
  now?: () => string;
  snapshotAsOf?: string;
  maxAgeHours?: number;
};

export function isHttpUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

/** Captures full page text once per normalized URL and reports per-URL retrieval gaps. */
export async function captureSources(urls: string[], options: CaptureOptions = {}): Promise<Map<string, SourceCapture>> {
  const unique = new Map<string, string>();
  for (const url of urls) if (isHttpUrl(url) && !unique.has(normalizeSourceUrl(url))) unique.set(normalizeSourceUrl(url), url);
  const retrievedAt = (options.now ?? (() => new Date().toISOString()))();
  if (!unique.size) return new Map(urls.map((url) => [url, { status: "unavailable", url, retrievedAt, error: "Invalid HTTP(S) URL" }]));

  const getContents = options.getContents ?? ((requested, requestOptions) => withRateLimitRetry(() => exa.getContents(requested, requestOptions)));
  let response: ContentsResponse;
  try {
    response = await getContents([...unique.values()], {
      text: true,
      filterEmptyResults: false,
      ...(options.snapshotAsOf && { snapshotAsOf: options.snapshotAsOf }),
      ...(options.maxAgeHours !== undefined && { maxAgeHours: options.maxAgeHours }),
    });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    return new Map(urls.map((url) => [url, { status: "unavailable", url, retrievedAt, error }]));
  }

  const results = new Map(response.results.map((result) => [normalizeSourceUrl(result.url), result]));
  const statuses = new Map(response.statuses?.filter(({ id }) => isHttpUrl(id)).map((status) => [normalizeSourceUrl(status.id), status.status]));
  return new Map(urls.map((url): [string, SourceCapture] => {
    if (!isHttpUrl(url)) return [url, { status: "unavailable", url, retrievedAt, error: "Invalid HTTP(S) URL" }];
    const normalized = normalizeSourceUrl(url);
    const result = results.get(normalized);
    if (result?.text?.trim()) return [url, { status: "retrieved", url, text: result.text, retrievedAt, snapshotAt: result.snapshotAt }];
    const providerStatus = statuses.get(normalized);
    return [url, { status: "unavailable", url, retrievedAt, error: providerStatus && providerStatus !== "success" ? providerStatus : "Content unavailable" }];
  }));
}
