export type HypothesisStatus = "supported" | "mixed" | "at-risk" | "contradicted";

export type EvidenceType = "supports" | "contradicts" | "neutral";

export type Evidence = {
  id: string;
  hypothesisId: string;
  title: string;
  claim: string;
  url: string;
  /** When the source was published. Missing for undated pages. */
  publishedAt?: string;
  /** When AsOf first saw it. */
  discoveredAt: string;
  type: EvidenceType;
  source: "search" | "agent" | "monitor";
};

/**
 * One append-only assessment of a hypothesis; the latest is its current state.
 * Always cites at least one piece of evidence. How confidence is judged is up to the assessor.
 */
export type HypothesisVersion = {
  asOf: string;
  confidence: number;
  status: HypothesisStatus;
  reasoning: string;
  evidenceIds: string[];
};

export type Hypothesis = {
  id: string;
  statement: string;
  /** From the latest version. Absent until the hypothesis has been assessed against evidence. */
  confidence?: number;
  status: HypothesisStatus | "untested";
  evidence: Evidence[];
  history: HypothesisVersion[];
};

export type Company = {
  id: string;
  name: string;
  description: string;
  hypotheses: Hypothesis[];
};
