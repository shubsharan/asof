import { normalizeSourceUrl } from "./source";
import type { Company, Evidence, Hypothesis, ResearchAssessment } from "./types";

export type HistoryMode = "recorded" | "reconstruction";

export function researchSummary(reasoning: string): string {
  return Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(reasoning)).slice(0, 2).map(({ segment }) => segment).join("").trim();
}

export function researchHistory(hypothesis: Hypothesis, mode: HistoryMode = "recorded"): ResearchAssessment[] {
  return (hypothesis.researchHistory ?? []).flatMap((item) => {
    const asOf = mode === "reconstruction"
      ? (item.origin === "reconstruction" ? item.targetDate : undefined)
      : (item.origin !== "reconstruction" && item.recordedAt?.includes("T") ? item.recordedAt : undefined);
    if (!asOf) return [];
    return [{ ...item, asOf, reasoning: item.reasoning.replace(/^Reconstructed on \d{4}-\d{2}-\d{2} from evidence published by \d{4}-\d{2}-\d{2}\.\s*/, "") }];
  }).sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf)
    || Date.parse(a.recordedAt ?? a.asOf) - Date.parse(b.recordedAt ?? b.asOf) || a.id - b.id);
}

function before(date: string, cutoff?: string): boolean {
  return !cutoff || (cutoff.length === 10 ? date.slice(0, 10) <= cutoff : Date.parse(date) <= Date.parse(cutoff));
}

/** The API and browser share this selection; the two history clocks never substitute for each other. */
export function researchView(company: Company, asOf?: string, mode: HistoryMode = "recorded", assessmentId?: number): Company {
  const selectedAssessment = company.hypotheses.flatMap((hypothesis) => researchHistory(hypothesis, mode)).find((item) => item.id === assessmentId);
  const cutoff = selectedAssessment?.asOf ?? asOf;
  return { ...company, hypotheses: company.hypotheses.map((hypothesis) => {
    let history = researchHistory(hypothesis, mode).filter((item) => before(item.asOf, cutoff));
    const selected = history.findIndex((item) => item.id === assessmentId);
    if (selected !== -1) history = history.slice(0, selected + 1);
    const latest = history.at(-1);
    const cited = new Set(history.flatMap(({ evidenceIds }) => evidenceIds));
    const evidence = hypothesis.evidence.filter((item) => mode === "recorded"
      ? before(item.discoveredAt, cutoff)
      : cited.has(item.id) || (!cutoff || Boolean(item.publishedAt && before(item.publishedAt, cutoff))));
    return { ...hypothesis, history, evidence, verdict: latest?.verdict ?? "untested", confidence: latest?.confidence,
      reportCount: evidence.length, developmentCount: new Set(evidence.map((item) => item.groupId ?? item.id)).size };
  }) };
}

/** Pending claims are distinct from uncited claims and unresolved source leads. */
export function pendingResearch(hypothesis: Hypothesis): { leads: Evidence[]; claims: Evidence[] } {
  const considered = new Set(researchHistory(hypothesis).at(-1)?.consideredEvidenceIds ?? []);
  const available = hypothesis.evidence.filter((item) => item.review?.decision !== "irrelevant");
  const claims = available.filter((item) => item.kind === "claim");
  const urls = new Set(claims.map((claim) => normalizeSourceUrl(claim.url)));
  const versions = new Set(claims.map((claim) => `${normalizeSourceUrl(claim.url)}\0${claim.sourceVersionId}`));
  const resolved = (lead: Evidence) => lead.sourceVersion?.status === "retrieved"
    ? versions.has(`${normalizeSourceUrl(lead.url)}\0${lead.sourceVersionId}`)
    : urls.has(normalizeSourceUrl(lead.url));
  return { leads: available.filter((item) => item.kind !== "claim" && !resolved(item)), claims: claims.filter((item) => !considered.has(item.id)) };
}
