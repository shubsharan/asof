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
  /** Absent until someone (Search, Agent, triage) has judged its direction. */
  type?: EvidenceType;
  source: "search" | "agent" | "monitor";
  /** Why the source was judged credible, when the screening step recorded it. */
  sourceReasoning?: string;
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
  /** What would most change the assessment. */
  openQuestions: string[];
};

export type Hypothesis = {
  id: string;
  /** Which shared lens this is (e.g. "moat"): every company carries the same set, so the matrix can line them up. */
  lens: string;
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
  domain: string;
  /** Exa Agent Monitor tracking this company, once created. */
  monitorId?: string;
  hypotheses: Hypothesis[];
};

export type RunKind = "search" | "agent" | "monitor";
export type RunStatus = "queued" | "running" | "done" | "failed";
export type RunTrigger = "manual" | "schedule";

/** What a research run is aimed at: a hypothesis for search and agent, a whole company for monitor. */
export type RunTarget = { kind: RunKind; companyId: string; hypothesisId?: string };

type Assessed = Pick<Hypothesis, "confidence" | "status">;

export type RunResult = {
  evidenceAdded: number;
  /** Set by agent runs, which reassess the hypothesis. */
  assessment?: { before: Assessed; after: Assessed };
};

export type Run = RunTarget & {
  id: string;
  trigger: RunTrigger;
  scheduleId?: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: RunResult;
};

export type Schedule = RunTarget & {
  id: string;
  everyHours: number;
  enabled: boolean;
  nextRunAt: string;
  createdAt: string;
};

type UpdateSubject = { at: string; company: { id: string; name: string } };
type UpdateHypothesis = { id: string; statement: string };

/** One entry in the Updates feed, newest first. */
export type Update =
  | (UpdateSubject & { kind: "assessment"; hypothesis: UpdateHypothesis; before: Assessed; after: Assessed })
  | (UpdateSubject & { kind: "evidence"; hypothesis: UpdateHypothesis; evidence: Evidence[] })
  | (UpdateSubject & { kind: "run-failed"; hypothesis?: UpdateHypothesis; run: Run });
