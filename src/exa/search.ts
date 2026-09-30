import type { DeepSearchOutputGrounding, SearchResponse } from "exa-js";
import type { NewEvidence } from "../db/queries";
import type { Company, Hypothesis, SourceRelationship } from "../domain/types";
import { normalizeSourceUrl, isSourceRelationship, SOURCE_RELATIONSHIPS } from "../domain/source";
import { exa, withRateLimitRetry } from "./client";
import { isHttpUrl } from "./contents";

// Exa synthesizes this from the results. Per item it reasons about the source before judging direction.
const OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          claim: { type: "string" },
          sourceReasoning: { type: "string" },
          sourceRelationship: { type: "string", enum: [...SOURCE_RELATIONSHIPS] },
          type: { type: "string", enum: ["supports", "contradicts", "neutral"] },
        },
        required: ["url", "claim", "sourceReasoning", "sourceRelationship", "type"],
      },
    },
  },
  required: ["evidence"],
};

const systemPrompt = (subject: string, statement: string) => `
You are screening evidence for an investment hypothesis about ${subject}: "${statement}".
Return one item per page; url must be exactly one result URL, copied unchanged.
For each result, first write sourceReasoning: who published it (check the domain) and whether it is credible.
sourceRelationship: classify the publisher as company, investor, customer-partner, independent, or unknown. Use unknown when uncertain.
Keep only credible sources: the company itself, its investors, customers or partners, regulators, established
news outlets, and named practitioners writing from direct experience. Drop aggregators, SEO or AI-generated
content farms, scraped or mirrored copies, and pages whose claims are unattributed or vague.
claim: one sentence stating the specific fact the page reports (numbers, names, dates). Report what the page
says; never restate or paraphrase the hypothesis.
type: "supports" if the fact makes the hypothesis more likely, "contradicts" if less likely, "neutral" if relevant
but pointing neither way. Drop pages that do not bear on the hypothesis. Never guess; omit instead.`;

type Item = { sourceRelationship?: SourceRelationship; url: string; claim: string; sourceReasoning: string; type: NewEvidence["type"] };

export type SearchEvidence = NewEvidence & {
  excerpt?: string;
  grounding?: DeepSearchOutputGrounding[];
  sourceRelationship: SourceRelationship;
};

const isDirection = (value: unknown): value is NonNullable<NewEvidence["type"]> => value === "supports" || value === "neutral" || value === "contradicts";

export function parseSearchItems(value: unknown): Item[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Search returned malformed structured output");
  const evidence = (value as Record<string, unknown>).evidence;
  if (!Array.isArray(evidence)) throw new Error("Search returned malformed structured output");
  return evidence.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Search returned malformed evidence output");
    const item = value as Record<string, unknown>;
    if (typeof item.url !== "string" || !isHttpUrl(item.url) || typeof item.claim !== "string" || !item.claim.trim() || typeof item.sourceReasoning !== "string" || !item.sourceReasoning.trim() || !isDirection(item.type)) throw new Error("Search returned malformed evidence output");
    if (item.sourceRelationship !== undefined && !isSourceRelationship(item.sourceRelationship)) throw new Error("Search returned malformed source relationship");
    return { sourceRelationship: item.sourceRelationship, url: item.url, claim: item.claim, sourceReasoning: item.sourceReasoning, type: item.type };
  });
}

const host = (url: string) => {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};

export function searchResponseEvidence(response: SearchResponse<{ highlights: true }>, companyDomain: string): SearchEvidence[] {
  if (!response.output) throw new Error("Search completed without structured output");
  const byUrl = new Map(response.results.map((result) => [normalizeSourceUrl(result.url), result]));
  const items = parseSearchItems(response.output.content);
  return items.map((item) => {
    const result = byUrl.get(normalizeSourceUrl(item.url));
    if (!result) throw new Error(`Search cited a URL outside its native results: ${item.url}`);
    if (!isHttpUrl(result.url) || (result.publishedDate !== undefined && Number.isNaN(Date.parse(result.publishedDate)))) throw new Error("Search returned malformed native result metadata");
    if (!Array.isArray(response.output!.grounding)) throw new Error("Search returned malformed native grounding");
    const grounding = response.output!.grounding.filter(({ citations }) => Array.isArray(citations) && citations.some(({ url }) => isHttpUrl(url) && normalizeSourceUrl(url) === normalizeSourceUrl(item.url)));
    const resultHost = host(result.url);
    const companyHost = host(`https://${companyDomain}`);
    return {
      title: result.title ?? result.url,
      claim: item.claim,
      url: result.url,
      publishedAt: result.publishedDate,
      type: item.type,
      sourceReasoning: item.sourceReasoning,
      excerpt: result.highlights.filter(Boolean).join("\n\n") || undefined,
      grounding: grounding.length ? grounding : undefined,
      sourceRelationship: item.sourceRelationship ?? (resultHost === companyHost || resultHost.endsWith(`.${companyHost}`) ? "company" : "unknown"),
    };
  });
}

/**
 * Searches the web for credible evidence for and against one hypothesis about a company.
 * With `asOf`, only pages published on or before that date are returned.
 */
export async function searchEvidence(company: Company, hypothesis: Hypothesis, asOf?: string): Promise<SearchEvidence[]> {
  const subject = `${company.name} (${company.description})`;
  // One query per direction, phrased as what each outcome would look like, so contradicting evidence surfaces.
  const queries = [
    `${company.name} ${hypothesis.statement}`,
    `${company.name} problems, setbacks, criticism, customers leaving, competitors winning`,
  ];
  const responses = await Promise.all(
    queries.map((query) =>
      withRateLimitRetry(() =>
        exa.search(query, {
          type: "auto",
          systemPrompt: systemPrompt(subject, hypothesis.statement),
          outputSchema: OUTPUT_SCHEMA,
          contents: { highlights: true },
          endPublishedDate: asOf,
        }),
      ),
    ),
  );

  return responses.flatMap((response) => searchResponseEvidence(response, company.domain));
}
