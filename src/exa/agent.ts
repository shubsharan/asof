import type { AgentGroundingEntry, AgentRun } from "exa-js";
import type { NewClaim } from "../db/queries";
import type { Company, Direction, Hypothesis, SourceRelationship } from "../domain/types";
import { rubricText } from "../domain/rubric";
import { isSourceRelationship, SOURCE_RELATIONSHIPS } from "../domain/source";
import { exa, withRateLimitRetry } from "./client";
import { isHttpUrl } from "./contents";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["supports", "neutral", "contradicts"] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    reasoning: { type: "string" },
    changeReason: { type: "string" },
    openQuestions: { type: "array", maxItems: 5, items: { type: "string" } },
    consideredEvidenceIds: { type: "array", items: { type: "string" } },
    citedEvidenceIds: { type: "array", items: { type: "string" } },
    decisiveEvidenceIds: { type: "array", items: { type: "string" } },
    newClaims: {
      type: "array", maxItems: 20, items: {
        type: "object",
        properties: {
          ref: { type: "string" }, url: { type: "string" }, title: { type: "string" },
          sourceEvidenceId: { type: "string" },
          claim: { type: "string" }, excerpt: { type: "string" },
          relevanceReason: { type: "string" }, publishedAt: { type: "string" },
          type: { type: "string", enum: ["supports", "neutral", "contradicts"] },
          sourceReasoning: { type: "string" },
          sourceRelationship: { type: "string", enum: [...SOURCE_RELATIONSHIPS] },
        },
        required: ["ref", "url", "title", "claim", "excerpt", "relevanceReason", "type"],
      },
    },
  },
  required: ["verdict", "confidence", "reasoning", "changeReason", "openQuestions", "consideredEvidenceIds", "citedEvidenceIds", "decisiveEvidenceIds", "newClaims"],
};

export type AgentClaim = NewClaim & { ref: string; sourceEvidenceId?: string };
export type Evaluation = {
  verdict: Direction;
  confidence: number;
  reasoning: string;
  changeReason: string;
  openQuestions: string[];
  consideredEvidenceIds: string[];
  citedEvidenceIds: string[];
  decisiveEvidenceIds: string[];
  newClaims: AgentClaim[];
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
const direction = (value: unknown): value is Direction => typeof value === "string" && DIRECTIONS.includes(value as Direction);

export function parseEvaluation(value: unknown): Evaluation {
  const data = record(value);
  if (!data || !direction(data.verdict) || typeof data.confidence !== "number" || !Number.isInteger(data.confidence) || data.confidence < 0 || data.confidence > 100 ||
    !nonempty(data.reasoning) || !nonempty(data.changeReason) || !strings(data.openQuestions) ||
    !strings(data.consideredEvidenceIds) || !strings(data.citedEvidenceIds)?.length || !strings(data.decisiveEvidenceIds) || !Array.isArray(data.newClaims)) {
    throw new Error("Agent returned malformed assessment output");
  }
  const newClaims = data.newClaims.map((value): AgentClaim => {
    const item = record(value);
    if (!item || !nonempty(item.ref) || !nonempty(item.url) || !isHttpUrl(item.url) || !nonempty(item.title) ||
      !nonempty(item.claim) || !nonempty(item.excerpt) || !nonempty(item.relevanceReason) || !direction(item.type) ||
      (item.publishedAt !== undefined && (!nonempty(item.publishedAt) || Number.isNaN(Date.parse(item.publishedAt)))) ||
      (item.sourceReasoning !== undefined && !nonempty(item.sourceReasoning)) ||
      (item.sourceEvidenceId !== undefined && !nonempty(item.sourceEvidenceId)) ||
      (item.sourceRelationship !== undefined && !isSourceRelationship(item.sourceRelationship))) {
      throw new Error("Agent returned malformed claim output");
    }
    return {
      ref: item.ref, url: item.url, title: item.title, claim: item.claim, excerpt: item.excerpt,
      sourceEvidenceId: item.sourceEvidenceId as string | undefined,
      relevanceReason: item.relevanceReason, type: item.type,
      publishedAt: item.publishedAt as string | undefined,
      sourceReasoning: item.sourceReasoning as string | undefined,
      sourceRelationship: item.sourceRelationship as SourceRelationship | undefined,
    };
  });
  if (new Set(newClaims.map(({ ref }) => ref)).size !== newClaims.length) throw new Error("Agent returned duplicate claim references");
  return {
    verdict: data.verdict, confidence: data.confidence, reasoning: data.reasoning, changeReason: data.changeReason,
    openQuestions: strings(data.openQuestions)!, consideredEvidenceIds: strings(data.consideredEvidenceIds)!,
    citedEvidenceIds: strings(data.citedEvidenceIds)!, decisiveEvidenceIds: strings(data.decisiveEvidenceIds)!, newClaims,
  };
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

export function verifyEvaluationCitations(evaluation: Evaluation, hypothesis: Hypothesis, groundingValue?: unknown): void {
  const known = new Set(hypothesis.evidence.filter((e) => e.kind === "claim" && e.sourceVersion?.status === "retrieved" && e.excerpt).map((e) => e.id));
  const local = new Set(evaluation.newClaims.map(({ ref }) => ref));
  const valid = (id: string) => known.has(id) || local.has(id);
  const considered = new Set(evaluation.consideredEvidenceIds);
  const cited = new Set(evaluation.citedEvidenceIds);
  if (evaluation.consideredEvidenceIds.some((id) => !valid(id)) || evaluation.citedEvidenceIds.some((id) => !considered.has(id)) ||
    evaluation.decisiveEvidenceIds.some((id) => !cited.has(id)) || evaluation.newClaims.some(({ ref }) => known.has(ref))) {
    throw new Error("Agent cited evidence outside its passage-backed input or new claims");
  }
  parseGrounding(groundingValue);
}

/** Runs Exa Agent with frozen evidence IDs; new claims use response-local references. */
export async function evaluateHypothesis(company: Company, hypothesis: Hypothesis, asOf?: string, options: EvaluateOptions = {}): Promise<EvaluationResult> {
  if (options.maxCostDollars !== undefined && (!Number.isFinite(options.maxCostDollars) || options.maxCostDollars < 1 || options.maxCostDollars > 100)) throw new Error("Agent maxCostDollars must be finite and between 1 and 100");
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) throw new Error("Agent timeoutMs must be positive and finite");
  const previous = hypothesis.researchHistory?.at(-1);
  const evidence = hypothesis.evidence.map((item) => ({
    id: item.id, kind: item.kind ?? "legacy", url: item.url, title: item.title, claim: item.claim,
    excerpt: item.kind === "claim" ? item.excerpt : undefined,
    sourceText: item.kind !== "claim" && item.sourceVersion?.status === "retrieved" ? item.sourceVersion.text : undefined,
    publishedAt: item.publishedAt, type: item.type, relevanceReason: item.relevanceReason,
    sourceRelationship: item.relationship, sourceReasoning: item.sourceReasoning,
  }));
  const query = `Assess ${company.name} (${company.description}) on the hypothesis: "${hypothesis.statement}".
Research rubric: ${rubricText(hypothesis)}
Previous assessment: ${previous ? `${previous.verdict} (${previous.confidence}% confidence). ${previous.reasoning}` : "none; this is the initial recorded assessment"}.
Previous open questions: ${previous?.openQuestions.join("; ") || "none"}.
Use the passage-backed claim rows as evidence. Lead and legacy rows are research directions, not citable facts.
If a lead includes saved sourceText, extract exact passages from that text before searching again.
Set sourceEvidenceId to that input row's ID when extracting from its saved text. That pins the exact captured
version. Without sourceEvidenceId, the page will be fetched afresh and the excerpt must match that version.
Research the open questions, both supporting and challenging signals, and the credibility of sources. Extract
multiple distinct claims from a page when useful. Each newClaims item needs a unique local ref, exact contiguous
source passage in excerpt, a specific factual claim, relevanceReason connecting it to this hypothesis, and URL.
Never invent an excerpt or copy a monitor interpretation into it. If you cannot retrieve a passage, leave that
source as a lead outside newClaims. Existing citations must use exact input claim IDs; new citations use their
local ref. URLs alone are never citations. List every passage-backed claim you actually considered in
consideredEvidenceIds, including local refs. citedEvidenceIds must be a subset; decisiveEvidenceIds identifies
the cited facts that drove the verdict. "supports" means credible evidence makes the hypothesis more likely;
"contradicts" means less likely; "neutral" means mixed or insufficient evidence. Weigh source credibility,
independence, recency, and coverage. Explain the balance in reasoning and the change from the previous
assessment in changeReason. On the first run, use "Initial recorded assessment" as changeReason.
Confidence measures confidence in the verdict, not hypothesis probability.
${asOf ? `Reconstruct for publication cutoff ${asOf}. Every new claim needs a publishedAt on or before that date. This is retrospective research; do not claim historical page contents were verified.` : ""}`;
  const { id } = await withRateLimitRetry(() => exa.agent.runs.create({
    effort: "auto",
    ...(options.maxCostDollars === undefined ? {} : { budget: { maxCostDollars: options.maxCostDollars } }),
    query,
    input: { data: evidence },
    outputSchema: OUTPUT_SCHEMA,
  }));
  const run = await waitForRun(id, options.timeoutMs);
  console.log(`Agent run ${run.id}: ${run.stopReason}, $${run.costDollars?.total}`);
  if (!run.output?.structured) throw new Error(`Agent run ${run.id} completed without structured output`);
  const evaluation = parseEvaluation(run.output.structured);
  verifyEvaluationCitations(evaluation, hypothesis, run.output.grounding);
  return { evaluation, providerRunId: run.id, rawOutput: run.output, grounding: run.output.grounding ?? undefined };
}

const POLL_MS = 10_000;
const TIMEOUT_MS = 15 * 60_000;

async function waitForRun(id: string, timeoutMs = TIMEOUT_MS): Promise<AgentRun> {
  const started = Date.now();
  for (;;) {
    const run = await withRateLimitRetry(() => exa.agent.runs.get(id));
    if (run.status === "completed") return run;
    if (run.status === "failed" || run.status === "cancelled") throw new Error(`Agent run ${id} ${run.status}: ${run.error?.message ?? ""}`);
    if (Date.now() - started > timeoutMs) {
      try { await exa.agent.runs.cancel(id); }
      catch (cause) { throw new Error(`Agent run ${id} timed out and cancellation failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
      throw new Error(`Agent run ${id} did not finish within ${Math.ceil(timeoutMs / 60_000)} minutes`);
    }
    await Bun.sleep(POLL_MS);
  }
}
