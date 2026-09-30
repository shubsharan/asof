import type { NewEvidence } from "../db/queries";
import type { AgentGroundingEntry, AgentRun } from "exa-js";
import type { Company, Direction, Hypothesis, HypothesisVersion } from "../domain/types";
import { exa, withRateLimitRetry } from "./client";
import { normalizeSourceUrl, isSourceRelationship, SOURCE_RELATIONSHIPS } from "../domain/source";
import { isHttpUrl } from "./contents";

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
          sourceRelationship: { type: "string", enum: [...SOURCE_RELATIONSHIPS] },
        },
        required: ["url", "title", "claim", "type", "sourceReasoning", "sourceRelationship"],
      },
    },
  },
  required: ["verdict", "confidence", "reasoning", "openQuestions", "citedUrls", "newEvidence"],
};

export type Evaluation = Omit<HypothesisVersion, "asOf" | "evidenceIds"> & {
  confidence: number;
  /** URLs (recorded or new) the assessment rests on. */
  citedUrls: string[];
  newEvidence: NewEvidence[];
};

export type EvaluationResult = {
  evaluation: Evaluation;
  providerRunId: string;
  rawOutput: unknown;
  grounding?: unknown;
};

export type EvaluateOptions = { maxCostDollars?: number; timeoutMs?: number };

const DIRECTIONS: Direction[] = ["supports", "neutral", "contradicts"];
const record = (value: unknown): Record<string, unknown> | undefined => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const strings = (value: unknown): string[] | undefined => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();

export function parseEvaluation(value: unknown): Evaluation {
  const data = record(value);
  const verdict = data?.verdict;
  const confidence = data?.confidence;
  const reasoning = data?.reasoning;
  const openQuestions = strings(data?.openQuestions);
  const citedUrls = strings(data?.citedUrls);
  if (!data || !DIRECTIONS.includes(verdict as Direction) || !Number.isInteger(confidence) || typeof confidence !== "number" || confidence < 0 || confidence > 100 || !nonempty(reasoning) || !openQuestions || !citedUrls?.length || citedUrls.some((url) => !isHttpUrl(url)) || !Array.isArray(data.newEvidence)) {
    throw new Error("Agent returned malformed assessment output");
  }
  const newEvidence = data.newEvidence.map((value) => {
    const item = record(value);
    if (!item || !nonempty(item.url) || !isHttpUrl(item.url) || !nonempty(item.title) || !nonempty(item.claim) || !nonempty(item.sourceReasoning) || !DIRECTIONS.includes(item.type as Direction) || (item.publishedAt !== undefined && (!nonempty(item.publishedAt) || Number.isNaN(Date.parse(item.publishedAt))))) {
      throw new Error("Agent returned malformed evidence output");
    }
    if (item.sourceRelationship !== undefined && !isSourceRelationship(item.sourceRelationship)) throw new Error("Agent returned malformed source relationship");
    return { sourceRelationship: item.sourceRelationship, url: item.url, title: item.title, claim: item.claim, sourceReasoning: item.sourceReasoning, type: item.type as Direction, ...(item.publishedAt && { publishedAt: item.publishedAt }) };
  });
  return { verdict: verdict as Direction, confidence, reasoning, openQuestions, citedUrls, newEvidence };
}

export function parseGrounding(value: unknown): AgentGroundingEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Agent returned malformed native grounding");
  return value.map((value) => {
    const entry = record(value);
    if (!entry || typeof entry.field !== "string" || !Array.isArray(entry.citations)) throw new Error("Agent returned malformed native grounding");
    const citations = entry.citations.map((value) => {
      const citation = record(value);
      if (!citation || !nonempty(citation.url) || !isHttpUrl(citation.url) || (citation.title !== undefined && citation.title !== null && typeof citation.title !== "string")) throw new Error("Agent returned malformed native grounding");
      return { ...citation, url: citation.url, title: citation.title as string | null | undefined };
    });
    return { ...entry, field: entry.field, citations } as AgentGroundingEntry;
  });
}

function groundingUrls(grounding: AgentGroundingEntry[]): Set<string> {
  return new Set(grounding.flatMap(({ citations }) => citations.map(({ url }) => normalizeSourceUrl(url))));
}

export function verifyEvaluationCitations(evaluation: Evaluation, hypothesis: Hypothesis, groundingValue?: unknown): void {
  const recorded = new Set(hypothesis.evidence.map(({ url }) => normalizeSourceUrl(url)));
  const native = groundingUrls(parseGrounding(groundingValue));
  const generated = new Set(evaluation.newEvidence.map(({ url }) => normalizeSourceUrl(url)));
  const supported = (url: string) => recorded.has(normalizeSourceUrl(url)) || generated.has(normalizeSourceUrl(url)) && native.has(normalizeSourceUrl(url));
  const unsupported = new Set([
    ...evaluation.citedUrls.filter((url) => !supported(url)),
    ...evaluation.newEvidence.filter(({ url }) => !native.has(normalizeSourceUrl(url))).map(({ url }) => url),
  ]);
  if (unsupported.size) throw new Error(`Agent assessment has unsupported URL(s): ${[...unsupported].join(", ")}`);
}

/**
 * Runs Exa Agent to assess a company on one hypothesis, starting from the evidence already recorded.
 * The verdict uses the same words as evidence; confidence is in the verdict, not in the hypothesis.
 * With `asOf`, it is asked to assess as the team could have on that date.
 */
export async function evaluateHypothesis(company: Company, hypothesis: Hypothesis, asOf?: string, options: EvaluateOptions = {}): Promise<EvaluationResult> {
  if (options.maxCostDollars !== undefined && (!Number.isFinite(options.maxCostDollars) || options.maxCostDollars < 1 || options.maxCostDollars > 100)) throw new Error("Agent maxCostDollars must be finite and between 1 and 100");
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error("Agent timeoutMs must be positive and finite");
  const current = hypothesis.history.at(-1);
  const { id } = await withRateLimitRetry(() => exa.agent.runs.create({
    effort: "auto",
    ...(options.maxCostDollars === undefined ? {} : { budget: { maxCostDollars: options.maxCostDollars } }),
    query: `Evaluate the investment hypothesis about ${company.name} (${company.description}): "${hypothesis.statement}".
Previous AI assessment: ${current ? `evidence ${current.verdict} the hypothesis. ${current.reasoning}` : "unassessed"}.
The input data is the evidence already recorded; each item's type says whether it supports, contradicts or is
neutral to the hypothesis. Research further as needed, especially evidence that contradicts the hypothesis and
the credibility of the key sources. Then assess:
- verdict: which way the credible evidence points on balance. "supports" if it makes the hypothesis more likely,
  "contradicts" if less likely, "neutral" if it points both ways or is inconclusive.
- confidence (0-100): how confident you are in that verdict, not how likely the hypothesis is. High when the
  evidence is credible, independent, recent and covers the question; low when it is thin, self-reported, stale
  or you had to infer a lot. There is no fixed model. In reasoning, explain how you weighed the evidence so the
  team can review and refine the method.
- citedUrls: the URLs, from the input data or newEvidence, that the assessment rests on. Every cited URL absent
  from the input data must have a complete matching newEvidence record. If the 10-item newEvidence limit prevents
  that, omit the extra URL from citedUrls and reasoning rather than returning an orphan citation.
- newEvidence: credible sources not in the input data. claim states the specific fact the page reports;
  sourceReasoning says who published it and how credible it is; sourceRelationship classifies the publisher as company, investor, customer-partner, independent, or unknown. Use unknown when uncertain. type uses the same three words as verdict.
- openQuestions: what would most change your view.${
      asOf
        ? `\nAssess as of ${asOf}: use only information published on or before that date and ignore anything you know
about later events. Every newEvidence item must have a publishedAt on or before ${asOf}.`
        : ""
    }`,
    input: { data: hypothesis.evidence },
    outputSchema: OUTPUT_SCHEMA,
  }));
  const run = await waitForRun(id, options.timeoutMs);
  console.log(`Agent run ${run.id}: ${run.stopReason}, $${run.costDollars?.total}`);
  if (!run.output?.structured) throw new Error(`Agent run ${run.id} completed without structured output`);
  const evaluation = parseEvaluation(run.output.structured);
  verifyEvaluationCitations(evaluation, hypothesis, run.output.grounding);
  return {
    evaluation,
    providerRunId: run.id,
    rawOutput: run.output,
    grounding: run.output.grounding ?? undefined,
  };
}

const POLL_MS = 10_000; // runs take minutes; the SDK's 1s polling would trip the rate limit across parallel runs
const TIMEOUT_MS = 15 * 60_000;

/** Polls an Agent run until it finishes, tolerating rate limits, and throws if it failed or was cancelled. */
async function waitForRun(id: string, timeoutMs = TIMEOUT_MS): Promise<AgentRun> {
  const started = Date.now();
  for (;;) {
    const run = await withRateLimitRetry(() => exa.agent.runs.get(id));
    if (run.status === "completed") return run;
    if (run.status === "failed" || run.status === "cancelled") throw new Error(`Agent run ${id} ${run.status}: ${run.error?.message ?? ""}`);
    if (Date.now() - started > timeoutMs) {
      try {
        await exa.agent.runs.cancel(id);
      } catch (cause) {
        const cancellation = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Agent run ${id} timed out and cancellation failed: ${cancellation}`);
      }
      throw new Error(`Agent run ${id} did not finish within ${Math.ceil(timeoutMs / 60_000)} minutes`);
    }
    await Bun.sleep(POLL_MS);
  }
}
