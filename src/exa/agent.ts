import type { NewEvidence } from "../db/queries";
import type { Company, Hypothesis, HypothesisVersion } from "../domain/types";
import { exa, withRateLimitRetry } from "./client";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["supports", "neutral", "contradicts"] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    reasoning: { type: "string" },
    openQuestions: { type: "array", maxItems: 5, items: { type: "string" } },
    citedUrls: { type: "array", items: { type: "string" } },
    newEvidence: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          claim: { type: "string" },
          publishedAt: { type: "string" },
          type: { type: "string", enum: ["supports", "neutral", "contradicts"] },
          sourceReasoning: { type: "string" },
        },
        required: ["url", "title", "claim", "type", "sourceReasoning"],
      },
    },
  },
  required: ["verdict", "confidence", "reasoning", "openQuestions", "citedUrls", "newEvidence"],
};

export type Evaluation = Omit<HypothesisVersion, "asOf" | "evidenceIds"> & {
  /** URLs (recorded or new) the assessment rests on. */
  citedUrls: string[];
  newEvidence: NewEvidence[];
};

/**
 * Runs Exa Agent to assess a company on one hypothesis, starting from the evidence already recorded.
 * The verdict uses the same words as evidence; confidence is in the verdict, not in the hypothesis.
 * With `asOf`, it is asked to assess as the team could have on that date.
 */
export async function evaluateHypothesis(company: Company, hypothesis: Hypothesis, asOf?: string): Promise<Evaluation> {
  const current = hypothesis.history.at(-1);
  const { id } = await withRateLimitRetry(() => exa.agent.runs.create({
    effort: "auto",
    query: `Evaluate the investment hypothesis about ${company.name} (${company.description}): "${hypothesis.statement}".
Current assessment: ${current ? `evidence ${current.verdict} the hypothesis (${current.confidence}% confident). ${current.reasoning}` : "untested, no prior assessment"}.
The input data is the evidence already recorded; each item's type says whether it supports, contradicts or is
neutral to the hypothesis. Research further as needed, especially evidence that contradicts the hypothesis and
the credibility of the key sources. Then assess:
- verdict: which way the credible evidence points on balance. "supports" if it makes the hypothesis more likely,
  "contradicts" if less likely, "neutral" if it points both ways or is inconclusive.
- confidence (0-100): how confident you are in that verdict, not how likely the hypothesis is. High when the
  evidence is credible, independent, recent and covers the question; low when it is thin, self-reported, stale
  or you had to infer a lot. There is no fixed model. In reasoning, explain how you weighed the evidence so the
  team can review and refine the method.
- citedUrls: the URLs, from the input data or newEvidence, that the assessment rests on.
- newEvidence: credible sources not in the input data. claim states the specific fact the page reports;
  sourceReasoning says who published it and how credible it is; type uses the same three words as verdict.
- openQuestions: what would most change your view.${
      asOf
        ? `\nAssess as of ${asOf}: use only information published on or before that date and ignore anything you know
about later events. Every newEvidence item must have a publishedAt on or before ${asOf}.`
        : ""
    }`,
    input: { data: hypothesis.evidence },
    outputSchema: OUTPUT_SCHEMA,
  }));
  const run = await waitForRun(id);
  console.log(`Agent run ${run.id}: ${run.stopReason}, $${run.costDollars?.total}`);
  return run.output?.structured as Evaluation;
}

const POLL_MS = 10_000; // runs take minutes; the SDK's 1s polling would trip the rate limit across parallel runs
const TIMEOUT_MS = 15 * 60_000;

/** Polls an Agent run until it finishes, tolerating rate limits, and throws if it failed or was cancelled. */
async function waitForRun(id: string) {
  const started = Date.now();
  for (;;) {
    const run = await withRateLimitRetry(() => exa.agent.runs.get(id));
    if (run.status === "completed") return run;
    if (run.status === "failed" || run.status === "cancelled") throw new Error(`Agent run ${id} ${run.status}: ${run.error?.message ?? ""}`);
    if (Date.now() - started > TIMEOUT_MS) throw new Error(`Agent run ${id} did not finish within 15 minutes`);
    await Bun.sleep(POLL_MS);
  }
}
