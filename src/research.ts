import type { Database } from "bun:sqlite";
import { assessHypothesis, getCompany, recordEvidence, setMonitorId } from "./db/queries";
import type { Company, Hypothesis } from "./domain/types";
import { evaluateHypothesis } from "./exa/agent";
import { createMonitor, monitorEvidence } from "./exa/monitor";
import { searchEvidence } from "./exa/search";

// The three research jobs, shared by the runner and the backfill script. `asOf` runs a job as of a
// past date: only evidence published by then, and the assessment is dated that day.

/** Loads a company and one of its hypotheses as they stood on `asOf` (default: now). */
export function loadHypothesis(db: Database, companyId: string, hypothesisId: string, asOf?: string) {
  const company = getCompany(db, companyId, asOf);
  const hypothesis = company?.hypotheses.find((h) => h.id === hypothesisId);
  return company && hypothesis ? { company, hypothesis } : undefined;
}

/** Research: find and tag evidence for a company's hypothesis (Exa Search). Returns what was newly added. */
export async function runResearch(db: Database, company: Company, hypothesis: Hypothesis, asOf?: string) {
  return recordEvidence(db, company.id, hypothesis.id, await searchEvidence(company, hypothesis, asOf), "search");
}

/**
 * Assess: a verdict and confidence for a company's hypothesis (Exa Agent). The agent may find
 * sources along the way; the ones it keeps are recorded so the assessment can cite them.
 * Returns the updated hypothesis.
 */
export async function runAssess(db: Database, company: Company, hypothesis: Hypothesis, asOf?: string) {
  const { citedUrls, newEvidence, ...assessment } = await evaluateHypothesis(company, hypothesis, asOf);
  // The Agent can't be date-limited by the API, so enforce the cutoff on what it brings back.
  const inWindow = asOf ? newEvidence.filter((e) => e.publishedAt && e.publishedAt.slice(0, 10) <= asOf) : newEvidence;
  const added = recordEvidence(db, company.id, hypothesis.id, inWindow, "agent");
  const cited = new Set(citedUrls);
  const evidenceIds = [...hypothesis.evidence, ...added].filter((e) => cited.has(e.url)).map((e) => e.id);
  const reasoning = asOf
    ? `Reconstructed on ${new Date().toISOString().slice(0, 10)} from evidence published by ${asOf}. ${assessment.reasoning}`
    : assessment.reasoning;
  assessHypothesis(db, company.id, hypothesis.id, { ...assessment, reasoning, evidenceIds }, asOf);
  return loadHypothesis(db, company.id, hypothesis.id, asOf)!.hypothesis;
}

/**
 * Watch: follow a company for new developments on every hypothesis (Exa Monitor). Starts its
 * monitor the first time, then records what the change feed has found. Safe to repeat: known URLs are skipped.
 */
export async function runWatch(db: Database, company: Company) {
  if (!company.monitorId) {
    setMonitorId(db, company.id, await createMonitor(company));
    company = getCompany(db, company.id)!;
  }
  return (await monitorEvidence(company)).flatMap((c) => recordEvidence(db, company.id, c.hypothesisId, c.evidence, "monitor", c.at));
}
