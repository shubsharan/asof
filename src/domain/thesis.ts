import type { Company, Evidence, Hypothesis, HypothesisStatus } from "./types";

const NUDGE_STEP = 5;
const MIN_CONFIDENCE = 5;
const MAX_CONFIDENCE = 95;

export function statusFromConfidence(confidence: number): HypothesisStatus {
  if (confidence >= 70) return "supported";
  if (confidence >= 60) return "mixed";
  if (confidence >= 45) return "at-risk";
  return "contradicted";
}

/** Moves confidence a fixed step per supporting/contradicting item. Agent results bypass this. */
export function nudge(confidence: number, evidence: Pick<Evidence, "type">[]): number {
  const delta = evidence.reduce(
    (sum, e) => sum + (e.type === "supports" ? NUDGE_STEP : e.type === "contradicts" ? -NUDGE_STEP : 0),
    0,
  );
  return Math.min(MAX_CONFIDENCE, Math.max(MIN_CONFIDENCE, confidence + delta));
}

// Dates are compared by day, so anything on the as-of date itself counts as known.
const day = (iso: string) => iso.slice(0, 10);

/** When the evidence became knowable: its publish date, or when we found it if undated. */
const knownAt = (e: Evidence) => e.publishedAt ?? e.discoveredAt;

/**
 * The thesis as it looked on `date`: each hypothesis at its latest version on or before
 * that day, with only the evidence published by then. Hypotheses with no version yet are dropped.
 */
export function thesisAsOf(company: Company, date: string): Company {
  const hypotheses = company.hypotheses.flatMap((h): Hypothesis[] => {
    const history = h.history.filter((v) => day(v.asOf) <= day(date));
    const latest = history.at(-1);
    if (!latest) return [];
    return [
      {
        ...h,
        confidence: latest.confidence,
        status: statusFromConfidence(latest.confidence),
        history,
        evidence: h.evidence.filter((e) => day(knownAt(e)) <= day(date)),
      },
    ];
  });
  return { ...company, hypotheses };
}

export type HypothesisChange = {
  id: string;
  statement: string;
  before?: { confidence: number; status: HypothesisStatus };
  after: { confidence: number; status: HypothesisStatus };
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
      before: prev && { confidence: prev.confidence, status: prev.status },
      after: { confidence: h.confidence, status: h.status },
      newEvidence: h.evidence.filter((e) => !seen.has(e.id)),
    };
  });
}
