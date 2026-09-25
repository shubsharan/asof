import type { Database } from "bun:sqlite";
import { assessHypothesis, getCompany, recordEvidence } from "./db/queries";
import type { Company, Hypothesis } from "./domain/types";
import { evaluateHypothesis } from "./exa/agent";
import { searchEvidence } from "./exa/search";

// Shared by the API routes and the backfill script. `asOf` runs research as of a past date:
// only evidence published by then, and the assessment is dated that day.

/** Loads a company and one of its hypotheses as they stood on `asOf` (default: now). */
export function loadHypothesis(db: Database, companyId: string, hypothesisId: string, asOf?: string) {
  const company = getCompany(db, companyId, asOf);
  const hypothesis = company?.hypotheses.find((h) => h.id === hypothesisId);
  return company && hypothesis ? { company, hypothesis } : undefined;
}

/** Exa Search → recorded evidence. Returns what was newly added. */
export async function runSearch(db: Database, company: Company, hypothesis: Hypothesis, asOf?: string) {
  return recordEvidence(db, hypothesis.id, await searchEvidence(company, hypothesis, asOf), "search");
}

/** Exa Agent → new evidence plus an assessment citing it. Returns the updated hypothesis. */
export async function runAgent(db: Database, company: Company, hypothesis: Hypothesis, asOf?: string) {
  const { citedUrls, newEvidence, ...assessment } = await evaluateHypothesis(company, hypothesis, asOf);
  // The Agent can't be date-limited by the API, so enforce the cutoff on what it brings back.
  const inWindow = asOf ? newEvidence.filter((e) => e.publishedAt && e.publishedAt.slice(0, 10) <= asOf) : newEvidence;
  const added = recordEvidence(db, hypothesis.id, inWindow, "agent");
  const cited = new Set(citedUrls);
  const evidenceIds = [...hypothesis.evidence, ...added].filter((e) => cited.has(e.url)).map((e) => e.id);
  const reasoning = asOf
    ? `Reconstructed on ${new Date().toISOString().slice(0, 10)} from evidence published by ${asOf}. ${assessment.reasoning}`
    : assessment.reasoning;
  assessHypothesis(db, hypothesis.id, { ...assessment, reasoning, evidenceIds }, asOf);
  return loadHypothesis(db, company.id, hypothesis.id, asOf)!.hypothesis;
}
