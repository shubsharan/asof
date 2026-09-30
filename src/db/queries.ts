import type { Database } from "bun:sqlite";
import { thesisAsOf } from "../domain/thesis";
import { normalizeSourceUrl } from "../domain/source";
import { rubricForHypothesis } from "../domain/rubric";
import { getWatch } from "./watches";
import type { AssessmentProposal, Company, Direction, Evidence, EvidenceReview, Hypothesis, HypothesisVersion, PortfolioHypothesis, ResearchAssessment, ReviewDecision, SourceRelationship, SourceVersion } from "../domain/types";

/** Evidence as it arrives from a source, before AsOf assigns an id and timestamps. */
export type NewEvidence = Pick<Evidence, "title" | "claim" | "url"> & Partial<Pick<Evidence, "publishedAt" | "type" | "sourceReasoning" | "excerpt" | "relevanceReason" | "kind">> & {
  contentText?: string;
  grounding?: unknown;
  sourceRelationship?: SourceRelationship;
};

export type NewClaim = Pick<Evidence, "title" | "claim" | "url" | "excerpt" | "type" | "relevanceReason"> & {
  excerpt: string; type: Direction; relevanceReason: string;
  publishedAt?: string; sourceReasoning?: string; sourceRelationship?: SourceRelationship; grounding?: unknown;
};

export type SourceCaptureInput =
  | { status: "retrieved"; url: string; text: string; retrievedAt: string; excerpt?: string; grounding?: unknown }
  | { status: "unavailable"; url: string; retrievedAt: string; error: string; grounding?: unknown };

type EvidenceRow = {
  id: string;
  company_id: string;
  hypothesis_id: string;
  title: string;
  claim: string;
  kind: "lead" | "claim" | "legacy";
  url: string;
  published_at: string | null;
  discovered_at: string;
  type: Evidence["type"] | null;
  source: Evidence["source"];
  source_reasoning: string | null;
  relevance_reason: string | null;
  grounding: string | null;
  imported: number;
  source_version_id: string | null;
  excerpt: string | null;
  verification_gap: string | null;
  relationship: SourceRelationship;
  relationship_automated: number;
  group_id: string | null;
  observation_hash: string;
};

type ReviewRow = { id: number; evidence_id: string; decision: ReviewDecision; note: string | null; reviewed_at: string };
type SourceRow = { id: string; url: string; retrieved_at: string; status: SourceVersion["status"]; content_hash: string | null; text: string | null; excerpt: string | null; grounding: string | null; error: string | null };

type VersionRow = {
  id: number;
  hypothesis_id: string;
  as_of: string;
  verdict: Direction;
  reasoning: string;
  evidence_ids: string;
  open_questions: string;
  reviewed_evidence_ids: string;
  reviewed_evidence_review_ids: string;
  proposal_id: string | null;
};

type ResearchRow = {
  id: number; hypothesis_id: string; target_date: string | null; recorded_at: string | null; original_as_of: string | null; verdict: Direction;
  confidence: number; reasoning: string; evidence_ids: string; open_questions: string; origin: ResearchAssessment["origin"];
  previous_assessment_id: number | null; input_evidence_ids: string | null; considered_evidence_ids: string | null;
  provider_run_id: string | null; raw_output: string | null; grounding: string | null;
  hypothesis_snapshot: string | null; change_reason: string | null; decisive_evidence_ids: string | null;
};

type ProposalRow = {
  id: string; company_id: string; hypothesis_id: string; status: AssessmentProposal["status"]; verdict: Direction;
  confidence: number; reasoning: string; open_questions: string; evidence_ids: string; input_evidence_ids: string;
  starting_assessment_id: number | null; provider_run_id: string; raw_output: string; grounding: string | null; created_at: string;
};

const toReview = (r: ReviewRow): EvidenceReview => ({
  id: r.id, evidenceId: r.evidence_id, decision: r.decision, note: r.note ?? undefined, reviewedAt: r.reviewed_at,
});

const toSourceVersion = (r: SourceRow): SourceVersion => ({
  id: r.id, url: r.url, retrievedAt: r.retrieved_at, status: r.status, contentHash: r.content_hash ?? undefined,
  text: r.text ?? undefined, excerpt: r.excerpt ?? undefined, grounding: r.grounding ? JSON.parse(r.grounding) : undefined,
  error: r.error ?? undefined,
});

const toEvidence = (r: EvidenceRow, reviewRows: ReviewRow[] = [], sourceVersion?: SourceVersion): Evidence => ({
  id: r.id,
  companyId: r.company_id,
  hypothesisId: r.hypothesis_id,
  title: r.title,
  claim: r.claim,
  kind: r.kind,
  url: r.url,
  publishedAt: r.published_at ?? undefined,
  discoveredAt: r.discovered_at,
  type: r.type ?? undefined,
  source: r.source,
  sourceReasoning: r.source_reasoning ?? undefined,
  relevanceReason: r.relevance_reason ?? undefined,
  grounding: r.grounding ? JSON.parse(r.grounding) : undefined,
  imported: r.imported === 1,
  reviewHistory: reviewRows.map(toReview),
  review: reviewRows.at(-1) ? toReview(reviewRows.at(-1)!) : undefined,
  sourceVersionId: r.source_version_id ?? undefined,
  sourceVersion,
  excerpt: r.excerpt ?? sourceVersion?.excerpt,
  verificationGap: r.verification_gap ?? undefined,
  relationship: r.relationship,
  relationshipAutomated: r.relationship_automated === 1,
  groupId: r.group_id ?? undefined,
});

const toVersion = (r: VersionRow): HypothesisVersion => ({
  id: r.id,
  asOf: r.as_of,
  verdict: r.verdict,
  reasoning: r.reasoning,
  evidenceIds: JSON.parse(r.evidence_ids),
  openQuestions: JSON.parse(r.open_questions),
  reviewedEvidenceIds: JSON.parse(r.reviewed_evidence_ids),
  reviewedEvidenceReviewIds: JSON.parse(r.reviewed_evidence_review_ids),
  proposalId: r.proposal_id ?? undefined,
});

const toResearch = (r: ResearchRow): ResearchAssessment => ({
  id: r.id, asOf: r.recorded_at ?? r.target_date ?? r.original_as_of ?? "", targetDate: r.target_date ?? undefined,
  recordedAt: r.recorded_at ?? undefined, verdict: r.verdict, confidence: r.confidence, reasoning: r.reasoning,
  evidenceIds: JSON.parse(r.evidence_ids), openQuestions: JSON.parse(r.open_questions), origin: r.origin,
  originalAsOf: r.original_as_of ?? undefined,
  previousAssessmentId: r.previous_assessment_id ?? undefined,
  inputEvidenceIds: r.input_evidence_ids ? JSON.parse(r.input_evidence_ids) : undefined,
  consideredEvidenceIds: r.considered_evidence_ids ? JSON.parse(r.considered_evidence_ids) : undefined,
  providerRunId: r.provider_run_id ?? undefined,
  rawOutput: r.raw_output ? JSON.parse(r.raw_output) : undefined,
  grounding: r.grounding ? JSON.parse(r.grounding) : undefined,
  hypothesisSnapshot: r.hypothesis_snapshot ? JSON.parse(r.hypothesis_snapshot) : undefined,
  changeReason: r.change_reason ?? undefined,
  decisiveEvidenceIds: r.decisive_evidence_ids ? JSON.parse(r.decisive_evidence_ids) : undefined,
});

const toProposal = (r: ProposalRow): AssessmentProposal => ({
  id: r.id, companyId: r.company_id, hypothesisId: r.hypothesis_id, status: r.status, verdict: r.verdict,
  confidence: r.confidence, reasoning: r.reasoning, openQuestions: JSON.parse(r.open_questions),
  evidenceIds: JSON.parse(r.evidence_ids), inputEvidenceIds: JSON.parse(r.input_evidence_ids),
  startingAssessmentId: r.starting_assessment_id ?? undefined, providerRunId: r.provider_run_id,
  rawOutput: JSON.parse(r.raw_output), grounding: r.grounding ? JSON.parse(r.grounding) : undefined, createdAt: r.created_at,
});

/** Adds a hypothesis to the portfolio. Every company is untested on it until assessed against evidence. */
export function createHypothesis(db: Database, h: PortfolioHypothesis): void {
  db.query("INSERT INTO hypotheses (id, name, statement, rubric) VALUES (?, ?, ?, ?)").run(
    h.id, h.name, h.statement, JSON.stringify(h.rubric ?? rubricForHypothesis(h.id) ?? null),
  );
}

/** The portfolio's hypotheses, in the order they were added. */
export function listHypotheses(db: Database): PortfolioHypothesis[] {
  return db.query<{ id: string; name: string; statement: string; rubric: string | null }, []>(
    "SELECT id, name, statement, rubric FROM hypotheses ORDER BY rowid",
  ).all().map((h) => ({ id: h.id, name: h.name, statement: h.statement,
    rubric: h.rubric ? JSON.parse(h.rubric) : rubricForHypothesis(h.id) }));
}

/**
 * Stores new evidence for a company's hypothesis, skipping URLs already recorded for that pair.
 * Evidence never changes confidence by itself; that takes an assessment.
 * Returns the evidence that was actually added.
 */
export function recordEvidence(
  db: Database,
  companyId: string,
  hypothesisId: string,
  items: NewEvidence[],
  source: Evidence["source"],
  now = new Date().toISOString(),
  captures: Map<string, SourceCaptureInput> = new Map(),
): Evidence[] {
  const insert = db.query<EvidenceRow, Record<string, string | null>>(
    `INSERT INTO evidence (id, company_id, hypothesis_id, title, claim, url, published_at, discovered_at, type, source, source_reasoning, imported,
       source_version_id, excerpt, verification_gap, relationship, relationship_automated, observation_hash, kind, relevance_reason, grounding)
     VALUES ($id, $companyId, $hypothesisId, $title, $claim, $url, $publishedAt, $now, $type, $source, $sourceReasoning, 0,
       $sourceVersionId, $excerpt, $verificationGap, $relationship, 1, $observationHash, 'lead', $relevanceReason, $grounding)
     ON CONFLICT (company_id, hypothesis_id, observation_hash) DO NOTHING
     RETURNING *`,
  );
  return db.transaction(() =>
    items.flatMap((item) => {
      const captured = captures.get(item.url) ?? (item.contentText ? {
        status: "retrieved" as const, url: item.url, text: item.contentText, retrievedAt: now, excerpt: item.excerpt, grounding: item.grounding,
      } : undefined);
      const capture = captured ? mergeCapture(captured, item) : undefined;
      const version = capture ? storeSourceVersion(db, capture) : undefined;
      const observationHash = evidenceObservationHash(item, version);
      const row = insert.get({
        id: crypto.randomUUID(),
        companyId,
        hypothesisId,
        title: item.title,
        claim: item.claim,
        url: item.url,
        publishedAt: item.publishedAt ?? null,
        now,
        type: item.type ?? null,
        source,
        sourceReasoning: item.sourceReasoning ?? null,
        relevanceReason: item.relevanceReason ?? null,
        grounding: item.grounding === undefined ? null : JSON.stringify(item.grounding),
        sourceVersionId: version?.id ?? null,
        excerpt: capture?.status === "retrieved" ? capture.excerpt ?? item.excerpt ?? null : item.excerpt ?? null,
        verificationGap: capture?.status === "unavailable" ? capture.error : capture ? null : "Source content was not captured",
        relationship: item.sourceRelationship ?? "unknown",
        observationHash,
      });
      return row ? [toEvidence(row, [], version)] : [];
    }),
  )();
}

const normalizePassage = (value: string) => value.replace(/\s+/g, " ").trim();

/** A source version gets one complete, immutable claim batch for a company and hypothesis. */
export function recordClaimBatch(
  db: Database,
  companyId: string,
  hypothesisId: string,
  items: NewClaim[],
  source: Evidence["source"],
  now = new Date().toISOString(),
  captures: Map<string, SourceCaptureInput> = new Map(),
): { claims: Evidence[]; added: Evidence[] } {
  if (!items.length) return { claims: [], added: [] };
  return db.transaction(() => {
    const groups = new Map<string, { version: SourceVersion; items: NewClaim[] }>();
    for (const item of items) {
      const capture = captures.get(item.url);
      if (!capture || capture.status !== "retrieved" || !normalizePassage(capture.text)
        || normalizeSourceUrl(capture.url) !== normalizeSourceUrl(item.url)) {
        throw new Error("Claim needs captured full source text for its URL");
      }
      const version = storeSourceVersion(db, capture);
      const group = groups.get(version.id);
      if (group) group.items.push(item);
      else groups.set(version.id, { version, items: [item] });
    }
    const claims: Evidence[] = [];
    const added: Evidence[] = [];
    for (const { version, items: batch } of groups.values()) {
      const existing = db.query<EvidenceRow, [string, string, string]>(
        "SELECT * FROM evidence WHERE company_id = ? AND hypothesis_id = ? AND source_version_id = ? AND kind = 'claim' ORDER BY rowid",
      ).all(companyId, hypothesisId, version.id);
      if (existing.length) {
        claims.push(...existing.map((row) => getEvidence(db, row.id)!));
        continue;
      }
      const seen = new Set<string>();
      for (const item of batch) {
        const claim = normalizePassage(item.claim);
        const excerpt = normalizePassage(item.excerpt);
        if (!item.title.trim() || !claim || !excerpt || !item.relevanceReason.trim()
          || !["supports", "neutral", "contradicts"].includes(item.type)) {
          throw new Error("Claim needs title, direction, claim, excerpt, and relevance reason");
        }
        if (!normalizePassage(version.text ?? "").includes(excerpt)) throw new Error("Claim excerpt is absent from saved source text");
        const identity = `${claim}\0${excerpt}`;
        if (seen.has(identity)) throw new Error("Duplicate claim in source batch");
        seen.add(identity);
        const row = db.query<EvidenceRow, Record<string, string | null>>(`INSERT INTO evidence
          (id, company_id, hypothesis_id, title, claim, url, published_at, discovered_at, type, source,
           source_reasoning, relevance_reason, grounding, imported, source_version_id, excerpt, relationship,
           relationship_automated, observation_hash, kind)
          VALUES ($id, $companyId, $hypothesisId, $title, $claim, $url, $publishedAt, $now, $type, $source,
           $sourceReasoning, $relevanceReason, $grounding, 0, $sourceVersionId, $excerpt, $relationship,
           1, $observationHash, 'claim') RETURNING *`).get({
          id: crypto.randomUUID(), companyId, hypothesisId, title: item.title, claim: item.claim,
          url: item.url, publishedAt: item.publishedAt ?? null, now, type: item.type, source,
          sourceReasoning: item.sourceReasoning ?? null, relevanceReason: item.relevanceReason,
          grounding: item.grounding === undefined ? null : JSON.stringify(item.grounding),
          sourceVersionId: version.id, excerpt: item.excerpt,
          relationship: item.sourceRelationship ?? "unknown",
          observationHash: hash([normalizeSourceUrl(item.url), version.id, identity].join("\0")),
        })!;
        const evidence = toEvidence(row, [], version);
        claims.push(evidence);
        added.push(evidence);
      }
    }
    return { claims, added };
  })();
}

export function resolveEvidenceObservation(
  db: Database,
  companyId: string,
  hypothesisId: string,
  item: NewEvidence,
  capture?: SourceCaptureInput,
): Evidence | undefined {
  const source = capture ?? (item.contentText ? {
    status: "retrieved" as const,
    url: item.url,
    text: item.contentText,
    retrievedAt: new Date().toISOString(),
    excerpt: item.excerpt,
    grounding: item.grounding,
  } : undefined);
  const merged = source ? mergeCapture(source, item) : undefined;
  const version = merged ? storeSourceVersion(db, merged) : undefined;
  const row = db.query<EvidenceRow, [string, string, string]>(
    "SELECT * FROM evidence WHERE company_id = ? AND hypothesis_id = ? AND observation_hash = ?",
  ).get(companyId, hypothesisId, evidenceObservationHash(item, version));
  return row ? getEvidence(db, row.id) : undefined;
}

function evidenceObservationHash(item: NewEvidence, version?: SourceVersion): string {
  const identity = version?.status === "retrieved" ? `content:${version.id}` : `claim:${item.claim.replace(/\s+/g, " ").trim()}`;
  return hash([normalizeSourceUrl(item.url), identity].join("\0"));
}

function mergeCapture(capture: SourceCaptureInput, item: NewEvidence): SourceCaptureInput {
  return capture.status === "retrieved"
    ? { ...capture, excerpt: item.excerpt ?? capture.excerpt, grounding: item.grounding ?? capture.grounding }
    : { ...capture, grounding: item.grounding ?? capture.grounding };
}

export function storeSourceVersion(db: Database, capture: SourceCaptureInput): SourceVersion {
  const url = normalizeSourceUrl(capture.url);
  if (capture.status === "retrieved") {
    const contentHash = hash(capture.text.replace(/\s+/g, " ").trim());
    const existing = db.query<SourceRow, [string, string]>("SELECT * FROM source_versions WHERE url = ? AND content_hash = ?").get(url, contentHash);
    if (existing) return toSourceVersion(existing);
    return toSourceVersion(db.query<SourceRow, Record<string, string | null>>(`INSERT INTO source_versions
      (id, url, retrieved_at, status, content_hash, text, excerpt, grounding)
      VALUES ($id, $url, $retrievedAt, 'retrieved', $contentHash, $text, $excerpt, $grounding) RETURNING *`).get({
      id: crypto.randomUUID(), url, retrievedAt: capture.retrievedAt, contentHash, text: capture.text,
      excerpt: capture.excerpt ?? null, grounding: capture.grounding === undefined ? null : JSON.stringify(capture.grounding),
    })!);
  }
  const existing = db.query<SourceRow, [string, string]>(
    "SELECT * FROM source_versions WHERE url = ? AND status = 'unavailable' AND error = ? ORDER BY retrieved_at DESC LIMIT 1",
  ).get(url, capture.error);
  if (existing) return toSourceVersion(existing);
  return toSourceVersion(db.query<SourceRow, Record<string, string | null>>(`INSERT INTO source_versions
    (id, url, retrieved_at, status, grounding, error) VALUES ($id, $url, $retrievedAt, 'unavailable', $grounding, $error) RETURNING *`).get({
    id: crypto.randomUUID(), url, retrievedAt: capture.retrievedAt,
    grounding: capture.grounding === undefined ? null : JSON.stringify(capture.grounding), error: capture.error,
  })!);
}

const hash = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

export function reviewEvidence(
  db: Database,
  evidenceId: string,
  input: { decision: ReviewDecision; note?: string },
  now = new Date().toISOString(),
): EvidenceReview {
  if (!input || !["relevant", "irrelevant", "disputed"].includes(input.decision)) throw new Error("Invalid evidence review decision");
  if (input.note !== undefined && typeof input.note !== "string") throw new Error("Invalid evidence review note");
  if (!db.query("SELECT 1 FROM evidence WHERE id = ?").get(evidenceId)) throw new Error(`Unknown evidence ${evidenceId}`);
  const row = db.query<ReviewRow, [string, ReviewDecision, string | null, string]>(
    "INSERT INTO evidence_reviews (evidence_id, decision, note, reviewed_at) VALUES (?, ?, ?, ?) RETURNING *",
  ).get(evidenceId, input.decision, input.note?.trim() || null, now)!;
  return toReview(row);
}

export type NewProposal = Omit<AssessmentProposal, "id" | "status" | "createdAt">;

export function createProposal(db: Database, proposal: NewProposal, now = new Date().toISOString()): AssessmentProposal {
  validateEvidence(db, proposal.companyId, proposal.hypothesisId, proposal.evidenceIds);
  validateEvidence(db, proposal.companyId, proposal.hypothesisId, proposal.inputEvidenceIds, true);
  rejectIrrelevant(db, proposal.companyId, proposal.hypothesisId, proposal.evidenceIds);
  const row = db.query<ProposalRow, Record<string, string | number | null>>(`INSERT INTO assessment_proposals
    (id, company_id, hypothesis_id, verdict, confidence, reasoning, open_questions, evidence_ids, input_evidence_ids,
     starting_assessment_id, provider_run_id, raw_output, grounding, created_at)
    VALUES ($id, $companyId, $hypothesisId, $verdict, $confidence, $reasoning, $openQuestions, $evidenceIds,
      $inputEvidenceIds, $startingAssessmentId, $providerRunId, $rawOutput, $grounding, $createdAt) RETURNING *`).get({
    id: crypto.randomUUID(), companyId: proposal.companyId, hypothesisId: proposal.hypothesisId, verdict: proposal.verdict,
    confidence: proposal.confidence, reasoning: proposal.reasoning, openQuestions: JSON.stringify(proposal.openQuestions),
    evidenceIds: JSON.stringify(proposal.evidenceIds), inputEvidenceIds: JSON.stringify(proposal.inputEvidenceIds),
    startingAssessmentId: proposal.startingAssessmentId ?? null, providerRunId: proposal.providerRunId,
    rawOutput: JSON.stringify(proposal.rawOutput), grounding: proposal.grounding === undefined ? null : JSON.stringify(proposal.grounding), createdAt: now,
  })!;
  return toProposal(row);
}

export function listProposals(db: Database, filter: { companyId?: string; hypothesisId?: string } = {}): AssessmentProposal[] {
  const where = ["1 = 1"];
  if (filter.companyId) where.push("company_id = $companyId");
  if (filter.hypothesisId) where.push("hypothesis_id = $hypothesisId");
  return db.query<ProposalRow, Record<string, string>>(
    `SELECT * FROM assessment_proposals WHERE ${where.join(" AND ")} ORDER BY created_at DESC, rowid DESC`,
  ).all({ ...(filter.companyId && { companyId: filter.companyId }), ...(filter.hypothesisId && { hypothesisId: filter.hypothesisId }) }).map(toProposal);
}

export function dismissProposal(db: Database, id: string): AssessmentProposal | undefined {
  const row = db.query<ProposalRow, [string]>(
    "UPDATE assessment_proposals SET status = 'dismissed' WHERE id = ? AND status = 'pending' RETURNING *",
  ).get(id) ?? db.query<ProposalRow, [string]>("SELECT * FROM assessment_proposals WHERE id = ?").get(id);
  return row ? toProposal(row) : undefined;
}

export type NewOfficialAssessment = {
  companyId: string; hypothesisId: string; proposalId?: string; verdict: Direction; reasoning: string;
  evidenceIds: string[]; reviewedEvidenceIds: string[]; openQuestions: string[];
};

export function saveAssessment(db: Database, assessment: NewOfficialAssessment, now = new Date().toISOString()): HypothesisVersion {
  if (!assessment || typeof assessment.companyId !== "string" || !assessment.companyId || typeof assessment.hypothesisId !== "string" || !assessment.hypothesisId) throw new Error("Assessment needs a company and hypothesis");
  if (!["supports", "neutral", "contradicts"].includes(assessment.verdict)) throw new Error("Invalid assessment verdict");
  if (typeof assessment.reasoning !== "string" || !assessment.reasoning.trim() || !isStringArray(assessment.evidenceIds) || !isStringArray(assessment.openQuestions)) {
    throw new Error("Invalid assessment contents");
  }
  if (!isStringArray(assessment.reviewedEvidenceIds)) throw new Error("Assessment must state which evidence was reviewed");
  if (assessment.proposalId !== undefined && typeof assessment.proposalId !== "string") throw new Error("Invalid proposal id");
  return db.transaction(() => {
    let proposal: ProposalRow | null = null;
    if (assessment.proposalId) {
      proposal = db.query<ProposalRow, [string]>("SELECT * FROM assessment_proposals WHERE id = ?").get(assessment.proposalId) ?? null;
      if (!proposal || proposal.company_id !== assessment.companyId || proposal.hypothesis_id !== assessment.hypothesisId) throw new Error("Unknown proposal for assessment target");
      if (proposal.status === "accepted") {
        const existing = db.query<VersionRow, [string]>("SELECT * FROM hypothesis_versions WHERE proposal_id = ?").get(proposal.id);
        if (existing) return toVersion(existing);
      }
      if (proposal.status !== "pending") throw new Error(`Proposal is ${proposal.status}`);
      const latest = db.query<{ id: number }, [string, string]>(
        "SELECT id FROM hypothesis_versions WHERE company_id = ? AND hypothesis_id = ? ORDER BY as_of DESC, id DESC LIMIT 1",
      ).get(assessment.companyId, assessment.hypothesisId)?.id;
      if ((latest ?? null) !== proposal.starting_assessment_id) throw new Error("Proposal is stale because the official assessment changed");
    }
    validateEvidence(db, assessment.companyId, assessment.hypothesisId, assessment.evidenceIds);
    validateEvidence(db, assessment.companyId, assessment.hypothesisId, assessment.reviewedEvidenceIds, true);
    const considered = new Set(assessment.reviewedEvidenceIds);
    if (assessment.evidenceIds.some((id) => !considered.has(id))) throw new Error("Cited evidence must be included in reviewed evidence");
    const reviewIds = currentReviewIds(db, assessment.companyId, assessment.hypothesisId, assessment.reviewedEvidenceIds);
    rejectIrrelevant(db, assessment.companyId, assessment.hypothesisId, assessment.evidenceIds);
    const row = db.query<VersionRow, Record<string, string | number | null>>(`INSERT INTO hypothesis_versions
      (company_id, hypothesis_id, as_of, verdict, reasoning, evidence_ids, open_questions, reviewed_evidence_ids, reviewed_evidence_review_ids, proposal_id)
      VALUES ($companyId, $hypothesisId, $now, $verdict, $reasoning, $evidenceIds, $openQuestions, $reviewedEvidenceIds, $reviewIds, $proposalId)
      RETURNING *`).get({ companyId: assessment.companyId, hypothesisId: assessment.hypothesisId, now, verdict: assessment.verdict,
      reasoning: assessment.reasoning, evidenceIds: JSON.stringify(assessment.evidenceIds), openQuestions: JSON.stringify(assessment.openQuestions),
      reviewedEvidenceIds: JSON.stringify(assessment.reviewedEvidenceIds), reviewIds: JSON.stringify(reviewIds), proposalId: proposal?.id ?? null })!;
    if (proposal) db.query("UPDATE assessment_proposals SET status = 'accepted' WHERE id = ?").run(proposal.id);
    return toVersion(row);
  })();
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

export function recordResearchAssessment(
  db: Database,
  companyId: string,
  hypothesisId: string,
  input: Omit<ResearchAssessment, "id" | "asOf">,
): ResearchAssessment {
  const hasProvenance = input.previousAssessmentId !== undefined || input.inputEvidenceIds !== undefined
    || input.consideredEvidenceIds !== undefined || input.providerRunId !== undefined
    || input.rawOutput !== undefined || input.grounding !== undefined || input.hypothesisSnapshot !== undefined
    || input.changeReason !== undefined || input.decisiveEvidenceIds !== undefined;
  if (hasProvenance) {
    if (!isStringArray(input.inputEvidenceIds) || !isStringArray(input.consideredEvidenceIds)
      || !isStringArray(input.decisiveEvidenceIds) || !isStringArray(input.evidenceIds)
      || typeof input.providerRunId !== "string" || !input.providerRunId.trim()
      || typeof input.hypothesisSnapshot?.statement !== "string" || !input.hypothesisSnapshot.statement.trim()
      || typeof input.changeReason !== "string" || !input.changeReason.trim()
      || input.rawOutput === undefined) throw new Error("Research assessment needs complete provenance");
    validateEvidence(db, companyId, hypothesisId, input.inputEvidenceIds, true);
    validateEvidence(db, companyId, hypothesisId, input.consideredEvidenceIds, true);
    const considered = new Set(input.consideredEvidenceIds);
    const cited = new Set(input.evidenceIds);
    if (input.evidenceIds.some((id) => !considered.has(id))) throw new Error("Cited evidence must be considered");
    if (input.decisiveEvidenceIds.some((id) => !cited.has(id))) throw new Error("Decisive evidence must be cited");
    if (input.origin === "reconstruction" && !input.targetDate) throw new Error("Reconstruction needs a target date");
    const latest = input.origin === "reconstruction"
      ? db.query<{ id: number }, [string, string, string]>(`SELECT id FROM research_assessments
          WHERE company_id = ? AND hypothesis_id = ? AND origin = 'reconstruction' AND target_date <= ?
          ORDER BY target_date DESC, recorded_at DESC, id DESC LIMIT 1`).get(companyId, hypothesisId, input.targetDate!)
      : db.query<{ id: number }, [string, string]>(`SELECT id FROM research_assessments
          WHERE company_id = ? AND hypothesis_id = ? AND origin = 'agent'
          ORDER BY recorded_at DESC, id DESC LIMIT 1`).get(companyId, hypothesisId);
    if ((input.previousAssessmentId ?? null) !== (latest?.id ?? null)) {
      throw new Error("Previous research assessment is stale or belongs to another target");
    }
    const citedRows = db.query<Pick<EvidenceRow, "id" | "kind" | "excerpt"> & { status: string | null; text: string | null }, [string]>(`
      SELECT e.id, e.kind, e.excerpt, s.status, s.text FROM evidence e
      LEFT JOIN source_versions s ON s.id = e.source_version_id
      WHERE e.id IN (SELECT value FROM json_each(?))`,
    ).all(JSON.stringify(input.evidenceIds));
    if (citedRows.some((row) => row.kind !== "claim" || row.status !== "retrieved"
      || !row.excerpt || !row.text || !normalizePassage(row.text).includes(normalizePassage(row.excerpt)))) {
      throw new Error("Research citations need saved source passages");
    }
  }
  validateEvidence(db, companyId, hypothesisId, input.evidenceIds);
  const row = db.query<ResearchRow, Record<string, string | number | null>>(`INSERT INTO research_assessments
    (company_id, hypothesis_id, target_date, recorded_at, verdict, confidence, reasoning, evidence_ids, open_questions, origin,
     previous_assessment_id, input_evidence_ids, considered_evidence_ids, provider_run_id, raw_output, grounding,
     hypothesis_snapshot, change_reason, decisive_evidence_ids)
    VALUES ($companyId, $hypothesisId, $targetDate, $recordedAt, $verdict, $confidence, $reasoning, $evidenceIds, $openQuestions, $origin,
      $previousAssessmentId, $inputEvidenceIds, $consideredEvidenceIds, $providerRunId, $rawOutput, $grounding,
      $hypothesisSnapshot, $changeReason, $decisiveEvidenceIds)
    RETURNING *`).get({ companyId, hypothesisId, targetDate: input.targetDate ?? null, recordedAt: input.recordedAt ?? null,
    verdict: input.verdict, confidence: input.confidence, reasoning: input.reasoning, evidenceIds: JSON.stringify(input.evidenceIds),
    openQuestions: JSON.stringify(input.openQuestions), origin: input.origin,
    previousAssessmentId: input.previousAssessmentId ?? null,
    inputEvidenceIds: input.inputEvidenceIds === undefined ? null : JSON.stringify(input.inputEvidenceIds),
    consideredEvidenceIds: input.consideredEvidenceIds === undefined ? null : JSON.stringify(input.consideredEvidenceIds),
    providerRunId: input.providerRunId ?? null, rawOutput: input.rawOutput === undefined ? null : JSON.stringify(input.rawOutput),
    grounding: input.grounding === undefined ? null : JSON.stringify(input.grounding),
    hypothesisSnapshot: input.hypothesisSnapshot === undefined ? null : JSON.stringify(input.hypothesisSnapshot),
    changeReason: input.changeReason ?? null,
    decisiveEvidenceIds: input.decisiveEvidenceIds === undefined ? null : JSON.stringify(input.decisiveEvidenceIds),
  })!;
  return toResearch(row);
}

function validateEvidence(db: Database, companyId: string, hypothesisId: string, ids: string[], allowEmpty = false): void {
  if (!allowEmpty && ids.length === 0) throw new Error("An assessment must cite evidence");
  const unique = [...new Set(ids)];
  const known = db.query<{ n: number }, [string, string, string]>(
    "SELECT count(*) AS n FROM evidence WHERE company_id = ? AND hypothesis_id = ? AND id IN (SELECT value FROM json_each(?))",
  ).get(companyId, hypothesisId, JSON.stringify(unique))!.n;
  if (known !== unique.length) throw new Error(`Assessment cites evidence not recorded for ${companyId} on ${hypothesisId}`);
}

function currentReviewIds(db: Database, companyId: string, hypothesisId: string, ids: string[]): number[] {
  if (!ids.length) return [];
  const rows = db.query<{ evidence_id: string; id: number; decision: ReviewDecision }, [string, string, string]>(`SELECT r.evidence_id, r.id, r.decision
    FROM evidence_reviews r JOIN evidence e ON e.id = r.evidence_id
    WHERE e.company_id = ? AND e.hypothesis_id = ? AND e.id IN (SELECT value FROM json_each(?))
      AND r.id = (SELECT max(r2.id) FROM evidence_reviews r2 WHERE r2.evidence_id = r.evidence_id)`,
  ).all(companyId, hypothesisId, JSON.stringify(ids));
  if (rows.length !== new Set(ids).size) throw new Error("Reviewed evidence must have an analyst review decision");
  if (rows.some((r) => r.decision === "irrelevant")) throw new Error("Irrelevant evidence cannot be marked as reviewed for an assessment");
  const byEvidence = new Map(rows.map((r) => [r.evidence_id, r.id]));
  return [...new Set(ids)].map((id) => byEvidence.get(id)!);
}

function rejectIrrelevant(db: Database, companyId: string, hypothesisId: string, ids: string[]): void {
  if (!ids.length) return;
  const count = db.query<{ n: number }, [string, string, string]>(`SELECT count(*) n FROM evidence e
    JOIN evidence_reviews r ON r.evidence_id = e.id
    WHERE e.company_id = ? AND e.hypothesis_id = ? AND e.id IN (SELECT value FROM json_each(?))
      AND r.id = (SELECT max(r2.id) FROM evidence_reviews r2 WHERE r2.evidence_id = e.id) AND r.decision = 'irrelevant'`,
  ).get(companyId, hypothesisId, JSON.stringify(ids))!.n;
  if (count) throw new Error("Irrelevant evidence cannot be cited");
}

export function setEvidenceRelationship(db: Database, evidenceId: string, relationship: SourceRelationship): Evidence {
  if (!["company", "investor", "customer-partner", "independent", "unknown"].includes(relationship)) throw new Error("Invalid source relationship");
  if (!db.query("UPDATE evidence SET relationship = ?, relationship_automated = 0 WHERE id = ? RETURNING id").get(relationship, evidenceId)) {
    throw new Error(`Unknown evidence ${evidenceId}`);
  }
  return getEvidence(db, evidenceId)!;
}

export function groupEvidence(
  db: Database,
  input: { evidenceIds: string[]; groupId?: string | null },
  now = new Date().toISOString(),
): Evidence[] {
  if (!isStringArray(input?.evidenceIds) || input.evidenceIds.length === 0) throw new Error("Evidence group needs evidence IDs");
  const ids = [...new Set(input.evidenceIds)];
  const rows = db.query<{ id: string; company_id: string; hypothesis_id: string }, [string]>(
    "SELECT id, company_id, hypothesis_id FROM evidence WHERE id IN (SELECT value FROM json_each(?))",
  ).all(JSON.stringify(ids));
  if (rows.length !== ids.length) throw new Error("Evidence group contains unknown evidence");
  const target = rows[0]!;
  if (rows.some((r) => r.company_id !== target.company_id || r.hypothesis_id !== target.hypothesis_id)) {
    throw new Error("Grouped evidence must share a company and hypothesis");
  }
  return db.transaction(() => {
    let groupId = input.groupId;
    if (groupId === undefined) {
      if (ids.length < 2) throw new Error("A new evidence group needs at least two reports");
      groupId = crypto.randomUUID();
      db.query("INSERT INTO evidence_groups (id, company_id, hypothesis_id, created_at) VALUES (?, ?, ?, ?)")
        .run(groupId, target.company_id, target.hypothesis_id, now);
    } else if (groupId !== null) {
      const group = db.query<{ company_id: string; hypothesis_id: string }, [string]>(
        "SELECT company_id, hypothesis_id FROM evidence_groups WHERE id = ?",
      ).get(groupId);
      if (!group) throw new Error(`Unknown evidence group ${groupId}`);
      if (group.company_id !== target.company_id || group.hypothesis_id !== target.hypothesis_id) throw new Error("Evidence group target does not match");
    }
    db.query("UPDATE evidence SET group_id = ? WHERE id IN (SELECT value FROM json_each(?))").run(groupId, JSON.stringify(ids));
    return ids.map((id) => getEvidence(db, id)!);
  })();
}

function getEvidence(db: Database, id: string): Evidence | undefined {
  const row = db.query<EvidenceRow, [string]>("SELECT * FROM evidence WHERE id = ?").get(id);
  if (!row) return undefined;
  const reviews = db.query<ReviewRow, [string]>("SELECT * FROM evidence_reviews WHERE evidence_id = ? ORDER BY reviewed_at, id").all(id);
  const source = row.source_version_id
    ? db.query<SourceRow, [string]>("SELECT * FROM source_versions WHERE id = ?").get(row.source_version_id)
    : undefined;
  return toEvidence(row, reviews, source ? toSourceVersion(source) : undefined);
}

/** Complete recorded data before any as-of projection. */
export function getCompanyData(db: Database, id: string): Company | undefined {
  const row = db
    .query<{ id: string; name: string; description: string; domain: string; runtime_monitor_id: string | null }, [string]>(
      `SELECT c.id, c.name, c.description, c.domain, w.monitor_id runtime_monitor_id
       FROM companies c LEFT JOIN company_watches w ON w.company_id = c.id WHERE c.id = ?`,
    )
    .get(id);
  if (!row) return undefined;
  const { runtime_monitor_id, ...company } = row;

  const versions = db
    .query<VersionRow, [string]>("SELECT * FROM hypothesis_versions WHERE company_id = ? ORDER BY as_of, id")
    .all(id);
  const evidence = db
    .query<EvidenceRow, [string]>("SELECT * FROM evidence WHERE company_id = ? ORDER BY coalesce(published_at, discovered_at)")
    .all(id);
  const reviews = db.query<ReviewRow, [string]>(`SELECT r.* FROM evidence_reviews r JOIN evidence e ON e.id = r.evidence_id
    WHERE e.company_id = ? ORDER BY r.reviewed_at, r.id`).all(id);
  const sourceVersions = db.query<SourceRow, [string]>(`SELECT DISTINCT s.* FROM source_versions s JOIN evidence e ON e.source_version_id = s.id
    WHERE e.company_id = ?`).all(id);
  const sourceById = new Map(sourceVersions.map((source) => [source.id, toSourceVersion(source)]));
  const research = db.query<ResearchRow, [string]>("SELECT * FROM research_assessments WHERE company_id = ? ORDER BY coalesce(recorded_at, target_date), id").all(id);
  const proposals = listProposals(db, { companyId: id }).filter((p) => p.status === "pending");

  const full: Company = {
    ...company,
    monitorId: runtime_monitor_id ?? undefined,
    watch: getWatch(db, id),
    hypotheses: listHypotheses(db).map(
      (h): Hypothesis => ({
        ...h,
        verdict: "untested", // filled in from the latest version by thesisAsOf
        history: versions.filter((v) => v.hypothesis_id === h.id).map(toVersion),
        researchHistory: research.filter((v) => v.hypothesis_id === h.id).map(toResearch),
        pendingProposals: proposals.filter((p) => p.hypothesisId === h.id),
        evidence: evidence.filter((e) => e.hypothesis_id === h.id).map((e) => toEvidence(
          e,
          reviews.filter((r) => r.evidence_id === e.id),
          e.source_version_id ? sourceById.get(e.source_version_id) : undefined,
        )),
        reviewCounts: { unreviewed: 0, relevant: 0, irrelevant: 0, disputed: 0, pending: 0 },
        reportCount: evidence.filter((e) => e.hypothesis_id === h.id).length,
        developmentCount: new Set(evidence.filter((e) => e.hypothesis_id === h.id).map((e) => e.group_id ?? e.id)).size,
      }),
    ),
  };
  return full;
}

/** The company with full history and evidence, as it looked on `asOf` (default: now). */
export function getCompany(db: Database, id: string, asOf = new Date().toISOString()): Company | undefined {
  const company = getCompanyData(db, id);
  return company ? thesisAsOf(company, asOf) : undefined;
}

export function listCompaniesData(db: Database): Company[] {
  return db.query<{ id: string }, []>("SELECT id FROM companies ORDER BY rowid").all()
    .map((c) => getCompanyData(db, c.id)!);
}

/** Every company as it looked on `asOf`, via `getCompany`, so cross-company views share its as-of rules. */
export function listCompanies(db: Database, asOf?: string): Company[] {
  return db
    .query<{ id: string }, []>("SELECT id FROM companies ORDER BY rowid")
    .all()
    .map((c) => getCompany(db, c.id, asOf)!);
}
