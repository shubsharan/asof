import type { Company, Evidence, Hypothesis } from "./types";

// Dates are compared by day, so anything on the as-of date itself counts as known.
const day = (iso: string) => iso.slice(0, 10);
const knownBy = (iso: string, cursor: string) => cursor.length <= 10
  ? day(iso) <= cursor
  : Date.parse(iso) <= Date.parse(cursor);

/** Official history starts when AsOf recorded the evidence, regardless of its publication date. */
export const knownAt = (e: Evidence) => e.discoveredAt;

/**
 * The thesis as it looked on `date`: each hypothesis at its latest assessment on or before
 * that day, with only the evidence recorded by then. Unassessed hypotheses are "untested".
 */
export function thesisAsOf(company: Company, date: string): Company {
  const hypotheses = company.hypotheses.map((h): Hypothesis => {
    const history = h.history.filter((v) => knownBy(v.asOf, date));
    const latest = history.at(-1);
    const capturedReviews = new Set(history.flatMap((v) => v.reviewedEvidenceReviewIds ?? []));
    const evidence = h.evidence.filter((e) => knownBy(knownAt(e), date)).map((e) => {
      const reviewHistory = (e.reviewHistory ?? []).filter((r) => knownBy(r.reviewedAt, date));
      return { ...e, reviewHistory, review: reviewHistory.at(-1) };
    });
    const reviewCounts = { unreviewed: 0, relevant: 0, irrelevant: 0, disputed: 0, pending: 0 };
    for (const e of evidence) {
      if (!e.review) reviewCounts.unreviewed++;
      else {
        reviewCounts[e.review.decision]++;
        if (e.review.decision !== "irrelevant" && !capturedReviews.has(e.review.id)) reviewCounts.pending++;
      }
    }
    return {
      ...h,
      confidence: latest?.confidence,
      verdict: latest?.verdict ?? "untested",
      history,
      evidence,
      reportCount: evidence.length,
      developmentCount: new Set(evidence.map((item) => item.groupId ?? item.id)).size,
      reviewCounts,
      pendingProposals: h.pendingProposals?.filter((p) => knownBy(p.createdAt, date)),
    };
  });
  return { ...company, hypotheses };
}

export type HypothesisChange = {
  id: string;
  statement: string;
  before: Pick<Hypothesis, "verdict" | "confidence">;
  after: Pick<Hypothesis, "verdict" | "confidence">;
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
      before: { verdict: prev?.verdict ?? "untested", confidence: prev?.confidence },
      after: { verdict: h.verdict, confidence: h.confidence },
      newEvidence: h.evidence.filter((e) => !seen.has(e.id)),
    };
  });
}
