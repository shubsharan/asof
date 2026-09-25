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

/** One append-only entry in a hypothesis's history. The latest one is its current state. */
export type HypothesisVersion = {
  asOf: string;
  confidence: number;
  reasoning: string;
  evidenceIds: string[];
};

export type Hypothesis = {
  id: string;
  statement: string;
  /** From the latest version. */
  confidence: number;
  /** Derived from confidence. */
  status: HypothesisStatus;
  evidence: Evidence[];
  history: HypothesisVersion[];
};

export type Company = {
  id: string;
  name: string;
  description: string;
  hypotheses: Hypothesis[];
};
