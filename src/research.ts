import type { Database } from "bun:sqlite";
import { getCompanyData, recordClaimBatch, recordEvidence, recordResearchAssessment, type NewClaim } from "./db/queries";
import { getWatch } from "./db/watches";
import { researchHistory } from "./domain/research";
import { normalizeSourceUrl } from "./domain/source";
import type { Company, Evidence, Hypothesis, ResearchAssessment } from "./domain/types";
import { evaluateHypothesis, parseGrounding, type AgentClaim, type EvaluationResult } from "./exa/agent";
import { captureSources, type SourceCapture } from "./exa/contents";
import { monitorEvidence } from "./exa/monitor";
import { searchEvidence } from "./exa/search";

type Capture = (urls: string[]) => Promise<Map<string, SourceCapture>>;
type Evaluate = (company: Company, hypothesis: Hypothesis, asOf?: string) => Promise<EvaluationResult>;
type Search = (company: Company, hypothesis: Hypothesis, asOf?: string) => Promise<NewClaim[]>;
const normalized = (text: string) => text.replace(/\s+/g, " ").trim();
const isCaptured = (claim: Pick<NewClaim, "excerpt">, capture?: SourceCapture) => capture?.status === "retrieved" &&
  normalized(capture.text).includes(normalized(claim.excerpt));
const asLead = ({ excerpt, type, relevanceReason, ...item }: NewClaim) => item;

function partitionCaptured<T extends NewClaim>(items: T[], captures: Map<string, SourceCapture>): { valid: T[]; unresolved: T[] } {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = normalizeSourceUrl(item.url);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const valid: T[] = [];
  const unresolved: T[] = [];
  for (const group of groups.values()) {
    const sound = group.every((item) => isCaptured(item, captures.get(item.url)));
    (sound ? valid : unresolved).push(...group);
  }
  return { valid, unresolved };
}

export function loadHypothesis(db: Database, companyId: string, hypothesisId: string, asOf?: string) {
  const company = getCompanyData(db, companyId);
  const hypothesis = company?.hypotheses.find((h) => h.id === hypothesisId);
  if (!company || !hypothesis) return undefined;
  const evidence = asOf ? hypothesis.evidence.filter((e) => e.publishedAt && e.publishedAt.slice(0, 10) <= asOf) : hypothesis.evidence;
  return { company, hypothesis: { ...hypothesis, evidence } };
}

/** A publication cutoff is retrospective; it does not assert past page contents. */
export function loadResearchHypothesis(db: Database, companyId: string, hypothesisId: string, targetDate: string) {
  return loadHypothesis(db, companyId, hypothesisId, targetDate);
}

/** Search extracts passage-backed claims; storage verifies the exact passage against captured text. */
export async function runResearch(db: Database, company: Company, hypothesis: Hypothesis, asOf?: string, capture: Capture = captureSources, search: Search = searchEvidence) {
  const seen = new Set<string>();
  const items = (await search(company, hypothesis, asOf)).filter((item) => {
    const key = [normalizeSourceUrl(item.url), normalized(item.claim), normalized(item.excerpt)].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (asOf && items.some((item) => !item.publishedAt || item.publishedAt.slice(0, 10) > asOf)) {
    throw new Error(`Search returned a claim outside publication cutoff ${asOf}`);
  }
  const captures = await capture([...new Set(items.map((item) => item.url))]);
  const { valid, unresolved } = partitionCaptured(items, captures);
  if (unresolved.length) recordEvidence(db, company.id, hypothesis.id, unresolved.map(asLead), "search", new Date().toISOString(), captures);
  const { claims, added } = recordClaimBatch(db, company.id, hypothesis.id, valid, "search", new Date().toISOString(), captures);
  const mismatch = valid.find((item) => !claims.some((claim) => normalizeSourceUrl(claim.url) === normalizeSourceUrl(item.url) && normalized(claim.claim) === normalized(item.claim) && normalized(claim.excerpt ?? "") === normalized(item.excerpt)));
  if (mismatch) throw new Error(`Search claim did not resolve to captured passage: ${mismatch.url}`);
  if (unresolved.length) throw new Error(`Search claims lack captured source passages: ${unresolved.map((item) => item.url).join(", ")}`);
  return added;
}

function predecessor(hypothesis: Hypothesis, asOf?: string): ResearchAssessment | undefined {
  if (!asOf) return researchHistory(hypothesis).filter((item) => item.origin === "agent").at(-1);
  return researchHistory(hypothesis, "reconstruction").filter((item) => item.targetDate && item.targetDate <= asOf).at(-1);
}

/** Agent output is checked against the frozen input and captured passages before it becomes research. */
export async function runAssess(db: Database, company: Company, hypothesis: Hypothesis, asOf?: string, evaluate: Evaluate = evaluateHypothesis, capture: Capture = captureSources) {
  const inputEvidence = hypothesis.evidence.filter((e) => e.review?.decision !== "irrelevant" &&
    (!asOf || Boolean(e.publishedAt && e.publishedAt.slice(0, 10) <= asOf)));
  const previous = predecessor(hypothesis, asOf);
  const inputHypothesis = { ...hypothesis, evidence: inputEvidence, researchHistory: previous ? [previous] : [], history: previous ? [previous] : [] };
  const result = await evaluate(company, inputHypothesis, asOf);
  const { evaluation } = result;
  const inputIds = new Set(inputEvidence.map((e) => e.id));
  const claimIds = new Set(inputEvidence.filter((e) => e.kind === "claim" && e.sourceVersion?.status === "retrieved" && e.excerpt).map((e) => e.id));
  const localRefs = new Set(evaluation.newClaims.map((item) => item.ref));
  const validRef = (id: string) => claimIds.has(id) || localRefs.has(id);
  if (localRefs.size !== evaluation.newClaims.length || evaluation.newClaims.some((item) => inputIds.has(item.ref)) ||
    evaluation.consideredEvidenceIds.some((id) => !validRef(id)) ||
    evaluation.citedEvidenceIds.length === 0 || evaluation.citedEvidenceIds.some((id) => !validRef(id)) ||
    evaluation.decisiveEvidenceIds.some((id) => !evaluation.citedEvidenceIds.includes(id))) {
    throw new Error("Agent referenced evidence outside its frozen passage-backed input");
  }
  const byInputId = new Map(inputEvidence.map((item) => [item.id, item]));
  for (const item of evaluation.newClaims) if (item.sourceEvidenceId) {
    const source = byInputId.get(item.sourceEvidenceId);
    if (!source || normalizeSourceUrl(source.url) !== normalizeSourceUrl(item.url) || source.sourceVersion?.status !== "retrieved" || !source.sourceVersion.text) {
      throw new Error(`Agent claim ${item.ref} has an invalid source evidence ID`);
    }
  }
  const freshUrls = [...new Set(evaluation.newClaims.filter((item) => !item.sourceEvidenceId).map((item) => item.url))];
  const fetched = freshUrls.length ? await capture(freshUrls) : new Map<string, SourceCapture>();
  const grounding = parseGrounding(result.grounding);
  const inputUrls = new Set(inputEvidence.map((item) => normalizeSourceUrl(item.url)));
  const nativeUrls = new Set(grounding.flatMap((entry) => entry.citations.map((citation) => normalizeSourceUrl(citation.url))));
  const sourced = evaluation.newClaims.map((item, index) => ({
    ...item, grounding: grounding.filter((entry) => entry.field.includes(`newClaims[${index}]`)),
  }));
  const capturedByRef = new Map(sourced.map((item) => {
    const version = item.sourceEvidenceId ? byInputId.get(item.sourceEvidenceId)?.sourceVersion : undefined;
    const source: SourceCapture | undefined = version?.status === "retrieved" && version.text
      ? { status: "retrieved", url: item.url, text: version.text, retrievedAt: version.retrievedAt }
      : fetched.get(item.url);
    return [item.ref, source] as const;
  }));
  const groups = new Map<string, AgentClaim[]>();
  for (const item of sourced) {
    const source = capturedByRef.get(item.ref);
    const version = source?.status === "retrieved"
      ? new Bun.CryptoHasher("sha256").update(normalized(source.text)).digest("hex")
      : "unavailable";
    const key = `${normalizeSourceUrl(item.url)}\0${version}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const added: Evidence[] = [];
  const byRef = new Map<string, Evidence>();
  const unresolved: AgentClaim[] = [];
  let nativeGap = false;
  let late = false;
  for (const group of groups.values()) {
    const captures = new Map<string, SourceCapture>();
    for (const item of group) {
      const source = capturedByRef.get(item.ref);
      if (source) captures.set(item.url, source);
    }
    const hasLate = Boolean(asOf && group.some((item) => !item.publishedAt || item.publishedAt.slice(0, 10) > asOf));
    const lacksNative = group.some((item) => !inputUrls.has(normalizeSourceUrl(item.url)) && !nativeUrls.has(normalizeSourceUrl(item.url)));
    const lacksPassage = group.some((item) => !isCaptured(item, captures.get(item.url)));
    if (hasLate || lacksNative || lacksPassage) {
      late ||= hasLate;
      nativeGap ||= lacksNative;
      unresolved.push(...group);
      if (!hasLate) recordEvidence(db, company.id, hypothesis.id, group.map(({ ref, sourceEvidenceId, ...item }) => asLead(item)), "agent", new Date().toISOString(), captures);
      continue;
    }
    const batch = recordClaimBatch(db, company.id, hypothesis.id, group, "agent", new Date().toISOString(), captures);
    added.push(...batch.added);
    for (const item of group) {
      const matching = batch.claims.filter((claim) => normalizeSourceUrl(claim.url) === normalizeSourceUrl(item.url) && normalized(claim.claim) === normalized(item.claim) && normalized(claim.excerpt ?? "") === normalized(item.excerpt));
      if (matching.length !== 1) throw new Error(`Agent claim ${item.ref} did not resolve to one captured passage`);
      byRef.set(item.ref, matching[0]!);
    }
  }
  // Keep source leads and valid extracted claims even when this assessment cannot be published.
  if (late) throw new Error(`Agent returned a claim outside publication cutoff ${asOf}`);
  if (nativeGap) throw new Error("Agent returned a new source without native grounding");
  if (unresolved.length) throw new Error(`Agent claims lack captured source passages: ${unresolved.map((item) => item.ref).join(", ")}`);
  const resolve = (id: string) => byRef.get(id)?.id ?? id;
  const cited = [...new Set(evaluation.citedEvidenceIds.map(resolve))];
  const considered = [...new Set([...claimIds, ...evaluation.newClaims.map(({ ref }) => resolve(ref))])];
  if (cited.some((id) => !considered.includes(id))) throw new Error("Agent citation was not considered");
  const now = new Date().toISOString();
  const assessment = recordResearchAssessment(db, company.id, hypothesis.id, {
    verdict: evaluation.verdict, confidence: evaluation.confidence, reasoning: evaluation.reasoning,
    changeReason: evaluation.changeReason, openQuestions: evaluation.openQuestions, evidenceIds: cited,
    inputEvidenceIds: inputEvidence.map((e) => e.id), consideredEvidenceIds: considered,
    decisiveEvidenceIds: [...new Set(evaluation.decisiveEvidenceIds.map(resolve))],
    previousAssessmentId: previous?.id, providerRunId: result.providerRunId,
    rawOutput: result.rawOutput, grounding: result.grounding,
    hypothesisSnapshot: { statement: hypothesis.statement, rubric: hypothesis.rubric },
    recordedAt: now, ...(asOf ? { origin: "reconstruction" as const, targetDate: asOf } : { origin: "agent" as const }),
  });
  return { ...assessment, addedEvidenceIds: added.map((item) => item.id) };
}

export async function runWatch(db: Database, company: Company, capture: Capture = captureSources) {
  const watch = getWatch(db, company.id);
  if (!watch?.remoteMonitorId || (watch.status !== "watching" && watch.status !== "stop-failed")) throw new Error(`Company ${company.id} is not being watched`);
  const changes = await monitorEvidence({ ...company, monitorId: watch.remoteMonitorId });
  const captures = await capture(changes.flatMap((change) => change.evidence.map((item) => item.url)));
  const now = new Date().toISOString();
  return changes.flatMap((change) => recordEvidence(db, company.id, change.hypothesisId, change.evidence, "monitor", now, captures));
}
