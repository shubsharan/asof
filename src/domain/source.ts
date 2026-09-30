import type { SourceRelationship } from "./types";

export const SOURCE_RELATIONSHIPS = ["company", "investor", "customer-partner", "independent", "unknown"] as const;
export const isSourceRelationship = (value: unknown): value is SourceRelationship => SOURCE_RELATIONSHIPS.some((relationship) => relationship === value);

export function normalizeSourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.searchParams.sort();
  return url.toString();
}
