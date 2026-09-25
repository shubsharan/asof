import type { NewEvidence } from "../db/queries";
import type { Company, Hypothesis } from "../domain/types";
import { exa } from "./client";

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
          type: { type: "string", enum: ["supports", "contradicts", "neutral"] },
        },
        required: ["url", "claim", "sourceReasoning", "type"],
      },
    },
  },
  required: ["evidence"],
};

const systemPrompt = (subject: string, statement: string) => `
You are screening evidence for an investment hypothesis about ${subject}: "${statement}".
Return one item per page; url must be exactly one result URL, copied unchanged.
For each result, first write sourceReasoning: who published it (check the domain) and whether it is credible.
Keep only credible sources: the company itself, its investors, customers or partners, regulators, established
news outlets, and named practitioners writing from direct experience. Drop aggregators, SEO or AI-generated
content farms, scraped or mirrored copies, and pages whose claims are unattributed or vague.
claim: one sentence stating the specific fact the page reports (numbers, names, dates). Report what the page
says; never restate or paraphrase the hypothesis.
type: "supports" if the fact makes the hypothesis more likely, "contradicts" if less likely, "neutral" if relevant
but pointing neither way. Drop pages that do not bear on the hypothesis. Never guess; omit instead.`;

type Item = { url: string; claim: string; sourceReasoning: string; type: NewEvidence["type"] };

/**
 * Searches the web for credible evidence for and against one hypothesis about a company.
 * With `asOf`, only pages published on or before that date are returned.
 */
export async function searchEvidence(company: Company, hypothesis: Hypothesis, asOf?: string): Promise<NewEvidence[]> {
  const subject = `${company.name} (${company.description})`;
  // One query per direction, phrased as what each outcome would look like, so contradicting evidence surfaces.
  const queries = [
    `${company.name} ${hypothesis.statement}`,
    `${company.name} problems, setbacks, criticism, customers leaving, competitors winning`,
  ];
  const responses = await Promise.all(
    queries.map((query) =>
      exa.search(query, {
        // Deep runs several searches and reasons harder, which the source screening needs.
        type: "deep",
        systemPrompt: systemPrompt(subject, hypothesis.statement),
        outputSchema: OUTPUT_SCHEMA,
        contents: { highlights: true },
        endPublishedDate: asOf,
      }),
    ),
  );

  return responses.flatMap(({ results, output }) => toEvidence(results, output?.content));
}

type Result = { url: string; title?: string | null; publishedDate?: string };

/** Turns Exa's screened output into evidence, keeping only items grounded in an actual result. */
function toEvidence(results: Result[], content: unknown): NewEvidence[] {
  const byUrl = new Map(results.map((r) => [r.url, r]));
  const items = (content as { evidence?: Item[] } | undefined)?.evidence ?? [];
  // Grounding in a real result means title and publish date are real, not generated.
  return items.flatMap((item) => {
    const r = byUrl.get(item.url);
    if (!r) return [];
    const { claim, sourceReasoning, type } = item;
    return [{ title: r.title ?? r.url, claim, url: r.url, publishedAt: r.publishedDate, type, sourceReasoning }];
  });
}
