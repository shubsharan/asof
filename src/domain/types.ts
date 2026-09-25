/**
 * Which way something points relative to a hypothesis. One vocabulary for both levels: a piece of
 * evidence supports, contradicts or is neutral, and so is an assessment's verdict on the body of evidence.
 */
export type Direction = "supports" | "neutral" | "contradicts";

export type Evidence = {
  id: string;
  companyId: string;
  hypothesisId: string;
  title: string;
  claim: string;
  url: string;
  /** When the source was published. Missing for undated pages. */
  publishedAt?: string;
  /** When AsOf first saw it. */
  discoveredAt: string;
  /** Absent until someone (Research, Assess) has judged its direction. */
  type?: Direction;
  /** Which Exa tool found it: provenance, not the job that ran. */
  source: "search" | "agent" | "monitor";
  /** Why the source was judged credible, when the screening step recorded it. */
  sourceReasoning?: string;
};

/**
 * One append-only assessment of a company on a hypothesis; the latest is its current state.
 * Always cites at least one piece of evidence.
 */
export type HypothesisVersion = {
  asOf: string;
  /** Which way the credible evidence points, on balance. */
  verdict: Direction;
  /** How confident the assessor is in that verdict, 0–100. Not the probability the hypothesis is true. */
  confidence: number;
  reasoning: string;
  evidenceIds: string[];
  /** What would most change the assessment. */
  openQuestions: string[];
};

/** A hypothesis the whole portfolio is tracked on, e.g. "moat". */
export type PortfolioHypothesis = { id: string; name: string; statement: string };

/** One company's standing on a portfolio hypothesis. */
export type Hypothesis = PortfolioHypothesis & {
  /** From the latest version; absent and "untested" until the company has been assessed on it. */
  verdict: Direction | "untested";
  confidence?: number;
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
  /** Every portfolio hypothesis, in portfolio order. */
  hypotheses: Hypothesis[];
};

/**
 * The job a research run does. Research finds and tags evidence for one hypothesis (Exa Search);
 * Assess gives a verdict and confidence on one hypothesis (Exa Agent); Watch follows a whole
 * company for new developments (Exa Monitor).
 */
export type Job = "research" | "assess" | "watch";
export type RunStatus = "queued" | "running" | "done" | "failed";
export type RunTrigger = "manual" | "schedule";

/** What a run is aimed at: a company's hypothesis for research and assess, the whole company for watch. */
export type RunTarget = { job: Job; companyId: string; hypothesisId?: string };

type Assessed = Pick<Hypothesis, "verdict" | "confidence">;

export type RunResult = {
  evidenceAdded: number;
  /** Set by assess runs. */
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

/** One row in the Updates table: a single piece of evidence, with the company and hypothesis it bears on. */
export type Update = {
  /** When it became knowable (`knownAt`). */
  at: string;
  company: Pick<Company, "id" | "name" | "domain">;
  hypothesis: PortfolioHypothesis;
  evidence: Evidence;
};
