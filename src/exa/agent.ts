import type { NewEvidence } from "../db/queries";
import type { Company, Hypothesis, HypothesisVersion } from "../domain/types";
import { exa } from "./client";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    status: { type: "string", enum: ["supported", "mixed", "at-risk", "contradicted"] },
    reasoning: { type: "string" },
    openQuestions: { type: "array", maxItems: 5, items: { type: "string" } },
    citedUrls: { type: "array", items: { type: "string" } },
    newEvidence: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          title: { type: "string" },
          claim: { type: "string" },
          publishedAt: { type: "string" },
          type: { type: "string", enum: ["supports", "contradicts", "neutral"] },
          sourceReasoning: { type: "string" },
        },
        required: ["url", "title", "claim", "type", "sourceReasoning"],
      },
    },
  },
  required: ["confidence", "status", "reasoning", "openQuestions", "citedUrls", "newEvidence"],
};

export type Evaluation = Omit<HypothesisVersion, "asOf" | "evidenceIds"> & {
  /** URLs (recorded or new) the assessment rests on. */
  citedUrls: string[];
  newEvidence: NewEvidence[];
};

/** Runs Exa Agent to research and assess one hypothesis, starting from the evidence already recorded. */
export async function evaluateHypothesis(company: Company, hypothesis: Hypothesis): Promise<Evaluation> {
  const current = hypothesis.history.at(-1);
  const run = await exa.agent.runs.createAndWait({
    effort: "auto",
    query: `Evaluate the investment hypothesis about ${company.name} (${company.description}): "${hypothesis.statement}".
Current assessment: ${current ? `${current.confidence}% ${current.status}. ${current.reasoning}` : "untested, no prior assessment"}.
The input data is the evidence already recorded (url, claim, type, sourceReasoning, publishedAt). Research further as
needed, especially evidence that contradicts the hypothesis and the credibility of the key sources. Then assess:
- confidence: 0-100, your probability that the hypothesis is true. There is no fixed model. In reasoning, explain how
  you weighed the evidence (credibility, independence, self-reported vs independent, recency) so the team can review
  and refine the method.
- status: supported, mixed, at-risk or contradicted.
- citedUrls: the URLs, from the input data or newEvidence, that the assessment rests on.
- newEvidence: credible sources you found that are not in the input data. claim states the specific fact the page
  reports; sourceReasoning says who published it and how credible it is.
- openQuestions: what would most change your view.`,
    input: {
      data: hypothesis.evidence.map(({ url, claim, type, sourceReasoning, publishedAt }) => ({
        url,
        claim,
        type,
        sourceReasoning,
        publishedAt,
      })),
    },
    outputSchema: OUTPUT_SCHEMA,
  }, { timeoutMs: 15 * 60_000 }); // runs take several minutes; the SDK default gives up at 2
  console.log(`Agent run ${run.id}: ${run.stopReason}, $${run.costDollars?.total}`);
  return run.output?.structured as Evaluation;
}
