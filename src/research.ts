import type { Database } from "bun:sqlite";
import { getCompany, recordEvidence, recordResearchAssessment, resolveEvidenceObservation } from "./db/queries";
import { getWatch } from "./db/watches";
import { researchHistory } from "./domain/research";
import { normalizeSourceUrl } from "./domain/source";
import type { Company, Hypothesis } from "./domain/types";
import { evaluateHypothesis, type EvaluationResult } from "./exa/agent";
import { captureSources, type SourceCapture } from "./exa/contents";
import { monitorEvidence } from "./exa/monitor";
import { searchEvidence } from "./exa/search";

// The three research jobs, shared by the runner and the backfill script. `asOf` runs a job as of a
// past date: only evidence published by then, and the assessment is dated that day.

/** Loads a company and one of its hypotheses as they stood on `asOf` (default: now). */
export function loadHypothesis(db: Database, companyId: string, hypothesisId: string, asOf?: string) {
  const company = getCompany(db, companyId, asOf);
  const hypothesis = company?.hypotheses.find((h) => h.id === hypothesisId);
  return company && hypothesis ? { company, hypothesis } : undefined;
}

/** Reconstruction view: publication cutoff, separate from the official recorded-at rewind. */
export function loadResearchHypothesis(db: Database, companyId: string, hypothesisId: string, targetDate: string) {
  const loaded = loadHypothesis(db, companyId, hypothesisId);
  if (!loaded) return undefined;
  const research = loaded.hypothesis.researchHistory?.filter((v) =>
    v.targetDate ? v.targetDate <= targetDate : Boolean(v.recordedAt && v.recordedAt.slice(0, 10) <= targetDate),
  ) ?? [];
  return {
    company: loaded.company,
    hypothesis: {
      ...loaded.hypothesis,
      evidence: loaded.hypothesis.evidence.filter((e) => e.publishedAt && e.publishedAt.slice(0, 10) <= targetDate),
      history: research.map((v) => ({ ...v, asOf: v.targetDate ?? v.recordedAt ?? "" })),
    },
  };
}

/** Research: find and tag evidence for a company's hypothesis (Exa Search). Returns what was newly added. */
type Capture = (urls: string[]) => Promise<Map<string, SourceCapture>>;

export async function runResearch(db: Database, company: Company, hypothesis: Hypothesis, asOf?: string, capture: Capture = captureSources) {
  const items = await searchEvidence(company, hypothesis, asOf);
  return recordEvidence(db, company.id, hypothesis.id, items, "search", new Date().toISOString(), await capture(items.map((item) => item.url)));
}

/**
 * Assess: a verdict and confidence for a company's hypothesis (Exa Agent). The agent may find
 * sources along the way; the ones it keeps are recorded so the assessment can cite them.
 * Saves AI research directly, with a cutoff for historical reconstruction.
 */
type Evaluate = (company: Company, hypothesis: Hypothesis, asOf?: string) => Promise<EvaluationResult>;
export async function runAssess(db: Database, company: Company, hypothesis: Hypothesis, asOf?: string, evaluate: Evaluate = evaluateHypothesis, capture: Capture = captureSources) {
  const inputEvidence = asOf
    ? hypothesis.evidence
    : hypothesis.evidence.filter((e) => e.review?.decision !== "irrelevant");
  const inputHypothesis = { ...hypothesis, history: asOf ? hypothesis.history : researchHistory(hypothesis), evidence: inputEvidence };
  const { evaluation } = await evaluate(company, inputHypothesis, asOf);
  const { citedUrls, newEvidence, ...assessment } = evaluation;
  // The Agent can't be date-limited by the API, so enforce the cutoff on what it brings back.
  const inWindow = asOf ? newEvidence.filter((e) => e.publishedAt && e.publishedAt.slice(0, 10) <= asOf) : newEvidence;
  const captures = await capture(inWindow.map((item) => item.url));
  const added = recordEvidence(db, company.id, hypothesis.id, inWindow, "agent", new Date().toISOString(), captures);
  const newUrls = new Set(inWindow.map((item) => normalizeSourceUrl(item.url)));
  const resolved = inWindow.flatMap((item) => {
    const evidence = resolveEvidenceObservation(db, company.id, hypothesis.id, item, captures.get(item.url));
    return evidence ? [evidence] : [];
  });
  const cited = new Set(citedUrls.map(normalizeSourceUrl));
  const allowable = [...inputEvidence.filter((e) => !newUrls.has(normalizeSourceUrl(e.url))), ...resolved]
    .filter((e) => cited.has(normalizeSourceUrl(e.url)) && e.review?.decision !== "irrelevant")
  const allowableUrls = new Set(allowable.map((e) => normalizeSourceUrl(e.url)));
  const unsupported = [...cited].filter((url) => !allowableUrls.has(url));
  if (unsupported.length) throw new Error(`Agent cited evidence that was not recorded or allowed: ${unsupported.join(", ")}`);
  const evidenceIds = allowable.map((e) => e.id);
  if (asOf) {
    return { ...recordResearchAssessment(db, company.id, hypothesis.id, {
      ...assessment,
      reasoning: `Reconstructed on ${new Date().toISOString().slice(0, 10)} from evidence published by ${asOf}. ${assessment.reasoning}`,
      evidenceIds,
      targetDate: asOf,
      recordedAt: new Date().toISOString(),
      origin: "reconstruction",
    }), addedEvidenceIds: added.map((e) => e.id) };
  }
  return { ...recordResearchAssessment(db, company.id, hypothesis.id, {
    ...assessment, evidenceIds, recordedAt: new Date().toISOString(), origin: "agent",
  }), addedEvidenceIds: added.map((e) => e.id) };
}

/**
 * Collects an already-started remote monitor. Lifecycle creation and deletion live in watch.ts.
 */
export async function runWatch(db: Database, company: Company, capture: Capture = captureSources) {
  const watch = getWatch(db, company.id);
  if (!watch?.remoteMonitorId || (watch.status !== "watching" && watch.status !== "stop-failed")) throw new Error(`Company ${company.id} is not being watched`);
  company = { ...company, monitorId: watch.remoteMonitorId };
  const changes = await monitorEvidence(company);
  const captures = await capture(changes.flatMap((change) => change.evidence.map((item) => item.url)));
  const now = new Date().toISOString();
  return changes.flatMap((change) => recordEvidence(db, company.id, change.hypothesisId, change.evidence, "monitor", now, captures));
}
