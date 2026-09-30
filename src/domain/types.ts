/**
 * Which way something points relative to a hypothesis. One vocabulary for both levels: a piece of
 * evidence supports, contradicts or is neutral, and so is an assessment's verdict on the body of evidence.
 */
export type Direction = "supports" | "neutral" | "contradicts";
export type ResearchRubric = { supportingSignals: string[]; challengingSignals: string[]; period: string };
export type ReviewDecision = "relevant" | "irrelevant" | "disputed";

export type EvidenceReview = {
  id: number;
  evidenceId: string;
  decision: ReviewDecision;
  note?: string;
  reviewedAt: string;
};

export type SourceRelationship = "company" | "investor" | "customer-partner" | "independent" | "unknown";

export type SourceVersion = {
  id: string;
  url: string;
  retrievedAt: string;
  status: "retrieved" | "unavailable";
  contentHash?: string;
  text?: string;
  excerpt?: string;
  grounding?: unknown;
  error?: string;
};

export type Evidence = {
  id: string;
  companyId: string;
  hypothesisId: string;
  title: string;
  claim: string;
  kind?: "lead" | "claim" | "legacy";
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
  relevanceReason?: string;
  grounding?: unknown;
  /** True for evidence that existed before the review workflow was introduced. */
  imported?: boolean;
  review?: EvidenceReview;
  reviewHistory?: EvidenceReview[];
  sourceVersionId?: string;
  sourceVersion?: SourceVersion;
  excerpt?: string;
  verificationGap?: string;
  relationship: SourceRelationship;
  relationshipAutomated: boolean;
  groupId?: string;
};

/**
 * One append-only assessment of a company on a hypothesis; the latest is its current state.
 * Always cites at least one piece of evidence.
 */
export type HypothesisVersion = {
  id?: number;
  asOf: string;
  /** Which way the credible evidence points, on balance. */
  verdict: Direction;
  /** How confident the assessor is in that verdict, 0–100. Not the probability the hypothesis is true. */
  /** Present on model research. Official analyst assessments do not carry model confidence. */
  confidence?: number;
  reasoning: string;
  evidenceIds: string[];
  /** What would most change the assessment. */
  openQuestions: string[];
  reviewedEvidenceIds?: string[];
  reviewedEvidenceReviewIds?: number[];
  proposalId?: string;
};

export type ResearchAssessment = Omit<HypothesisVersion, "id" | "confidence" | "reviewedEvidenceIds" | "proposalId"> & {
  id: number;
  /** The historical cutoff for a reconstruction. */
  targetDate?: string;
  /** When AsOf actually recorded it. Unknown for date-only legacy rows. */
  recordedAt?: string;
  origin: "legacy" | "reconstruction" | "agent";
  confidence: number;
  /** The date field carried by a legacy row, without claiming what event it timed. */
  originalAsOf?: string;
  previousAssessmentId?: number;
  inputEvidenceIds?: string[];
  consideredEvidenceIds?: string[];
  providerRunId?: string;
  rawOutput?: unknown;
  grounding?: unknown;
  hypothesisSnapshot?: { statement: string; rubric?: ResearchRubric };
  changeReason?: string;
  decisiveEvidenceIds?: string[];
};

export type ProposalStatus = "pending" | "accepted" | "dismissed";

export type AssessmentProposal = {
  id: string;
  companyId: string;
  hypothesisId: string;
  status: ProposalStatus;
  verdict: Direction;
  confidence: number;
  reasoning: string;
  openQuestions: string[];
  evidenceIds: string[];
  inputEvidenceIds: string[];
  startingAssessmentId?: number;
  providerRunId: string;
  rawOutput: unknown;
  grounding?: unknown;
  createdAt: string;
};

/** A hypothesis the whole portfolio is tracked on, e.g. "moat". */
export type PortfolioHypothesis = { id: string; name: string; statement: string; rubric?: ResearchRubric };

/** One company's standing on a portfolio hypothesis. */
export type Hypothesis = PortfolioHypothesis & {
  /** From the latest version; absent and "untested" until the company has been assessed on it. */
  verdict: Direction | "untested";
  confidence?: number;
  evidence: Evidence[];
  history: HypothesisVersion[];
  researchHistory?: ResearchAssessment[];
  pendingProposals?: AssessmentProposal[];
  reviewCounts?: { unreviewed: number; relevant: number; irrelevant: number; disputed: number; pending: number };
  reportCount: number;
  developmentCount: number;
};

export type Company = {
  id: string;
  name: string;
  description: string;
  domain: string;
  /** Exa Agent Monitor tracking this company, once created. */
  monitorId?: string;
  watch?: WatchState;
  /** Every portfolio hypothesis, in portfolio order. */
  hypotheses: Hypothesis[];
};

export type WatchStatus = "stopped" | "starting" | "watching" | "stop-failed";
export type WatchState = {
  companyId: string;
  status: WatchStatus;
  remoteMonitorId?: string;
  idempotencyKey: string;
  collectionScheduleId?: string;
  lastCollectedAt?: string;
  latestFailure?: { at: string; message: string };
  remoteStatus?: "creating" | "pending_first_refresh" | "active";
  remoteRefresh?: { state: "idle" } | { state: "running"; startedAt: string; entitiesProcessed: number; entitiesTotal: number };
  lastRemoteRefreshAt?: string;
  remoteInspectionFailure?: { at: string; message: string };
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

export type RunResult = {
  evidenceAdded: number;
  evidenceIds: string[];
  /** Legacy runs may reference a stored proposal. */
  proposalId?: string;
  assessmentId?: number;
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
