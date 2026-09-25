import type { Company, Evidence, Hypothesis } from "./types";

// Dates are compared by day, so anything on the as-of date itself counts as known.
const day = (iso: string) => iso.slice(0, 10);

/** When the evidence became knowable: its publish date, or when we found it if undated. */
const knownAt = (e: Evidence) => e.publishedAt ?? e.discoveredAt;

/**
 * The thesis as it looked on `date`: each hypothesis at its latest assessment on or before
 * that day, with only the evidence published by then. Unassessed hypotheses are "untested".
 */
export function thesisAsOf(company: Company, date: string): Company {
  const hypotheses = company.hypotheses.map((h): Hypothesis => {
    const history = h.history.filter((v) => day(v.asOf) <= day(date));
    const latest = history.at(-1);
    return {
      ...h,
      confidence: latest?.confidence,
      status: latest?.status ?? "untested",
      history,
      evidence: h.evidence.filter((e) => day(knownAt(e)) <= day(date)),
    };
  });
  return { ...company, hypotheses };
}

export type HypothesisChange = {
  id: string;
  statement: string;
  before: Pick<Hypothesis, "confidence" | "status">;
  after: Pick<Hypothesis, "confidence" | "status">;
  newEvidence: Evidence[];
};

/** Per-hypothesis difference between two views of the same company (e.g. Mar 1 vs today). */
export function compareThesis(before: Company, after: Company): HypothesisChange[] {
  return after.hypotheses.map((h) => {
    const prev = before.hypotheses.find((p) => p.id === h.id);
    const seen = new Set(prev?.evidence.map((e) => e.id));
    return {
      id: h.id,
      statement: h.statement,
      before: { confidence: prev?.confidence, status: prev?.status ?? "untested" },
      after: { confidence: h.confidence, status: h.status },
      newEvidence: h.evidence.filter((e) => !seen.has(e.id)),
    };
  });
}
