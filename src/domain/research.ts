import type { Company, Hypothesis, HypothesisVersion } from "./types";

export function researchSummary(reasoning: string): string {
  return Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(reasoning)).slice(0, 2).map(({ segment }) => segment).join("").trim();
}

/** Research cutoffs describe reconstructed views; live research uses its recording time. */
export function researchHistory(hypothesis: Hypothesis): HypothesisVersion[] {
  const recorded = (hypothesis.researchHistory ?? []).flatMap((item) => {
    const asOf = item.targetDate ?? item.recordedAt ?? item.originalAsOf;
    const reasoning = item.origin === "reconstruction"
      ? item.reasoning.replace(/^Reconstructed on \d{4}-\d{2}-\d{2} from evidence published by \d{4}-\d{2}-\d{2}\.\s*/, "")
      : item.reasoning;
    return asOf ? [{ ...item, asOf, reasoning }] : [];
  });
  const proposals = (hypothesis.pendingProposals ?? []).map((item) => ({
    asOf: item.createdAt, verdict: item.verdict, confidence: item.confidence,
    reasoning: item.reasoning, evidenceIds: item.evidenceIds, openQuestions: item.openQuestions,
  }));
  return [...recorded, ...proposals].sort((a, b) => Date.parse(a.asOf) - Date.parse(b.asOf));
}

/** Display AI research directly, without rewriting any saved analyst decisions. */
export function researchView(company: Company, asOf?: string): Company {
  const before = (date: string) => !asOf || (asOf.length === 10 ? date.slice(0, 10) <= asOf : Date.parse(date) <= Date.parse(asOf));
  return { ...company, hypotheses: company.hypotheses.map((hypothesis) => {
    const history = researchHistory(hypothesis).filter((item) => before(item.asOf));
    const latest = history.at(-1);
    const cited = new Set(history.flatMap(({ evidenceIds }) => evidenceIds));
    const evidence = hypothesis.evidence.filter((item) => !asOf || cited.has(item.id) || before(item.publishedAt ?? item.discoveredAt));
    return { ...hypothesis, history, evidence, verdict: latest?.verdict ?? "untested", confidence: latest?.confidence };
  }) };
}
