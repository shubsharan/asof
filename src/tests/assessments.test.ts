import { expect, test } from "bun:test";
import { createProposal, createHypothesis, getCompany, listProposals, recordClaimBatch, reviewEvidence, saveAssessment } from "../db/queries";
import { createDb } from "../db/schema";
import { loadHypothesis, loadResearchHypothesis, runAssess } from "../research";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme', '', 'acme.example')");
  createHypothesis(db, { id: "moat", name: "Moat", statement: "Moat is strengthening" });
  const evidence = recordClaimBatch(db, "acme", "moat", [
    { title: "Source", claim: "Claim", excerpt: "Claim", relevanceReason: "Tests moat", url: "https://example.com/source", type: "supports", publishedAt: "2026-09-27" },
  ], "agent", "2026-09-28T12:00:00Z", new Map([["https://example.com/source", { status: "retrieved", url: "https://example.com/source", text: "Claim", retrievedAt: "2026-09-28T12:00:00Z" }]])).claims[0]!;
  reviewEvidence(db, evidence.id, { decision: "relevant" }, "2026-09-28T12:00:30Z");
  return { db, evidence };
}

function proposal(db: ReturnType<typeof createDb>, evidenceId: string, startingAssessmentId?: number) {
  return createProposal(db, {
    companyId: "acme", hypothesisId: "moat", verdict: "supports", confidence: 82, reasoning: "Evidence supports it",
    openQuestions: ["Durability?"], evidenceIds: [evidenceId], inputEvidenceIds: [evidenceId], startingAssessmentId,
    providerRunId: "agent-run-1", rawOutput: { structured: { verdict: "supports" } },
    grounding: [{ field: "reasoning", citations: [{ url: "https://example.com/source" }] }],
  }, "2026-09-28T12:01:00Z");
}

test("a proposal preserves provider provenance and leaves the official thesis unassessed", () => {
  const { db, evidence } = setup();
  const created = proposal(db, evidence.id);
  expect(created).toMatchObject({ providerRunId: "agent-run-1", status: "pending", inputEvidenceIds: [evidence.id] });
  expect(created.grounding).toBeArray();
  expect(getCompany(db, "acme")!.hypotheses[0]).toMatchObject({ verdict: "untested", history: [] });
  expect(listProposals(db, { companyId: "acme", hypothesisId: "moat" })).toHaveLength(1);
});

test("acceptance is atomic, validates citations, and repeated submission is idempotent", () => {
  const { db, evidence } = setup();
  const created = proposal(db, evidence.id);
  const input = { companyId: "acme", hypothesisId: "moat", proposalId: created.id, verdict: "supports" as const,
    reasoning: "Analyst conclusion", evidenceIds: [evidence.id], reviewedEvidenceIds: [evidence.id], openQuestions: [] };
  const first = saveAssessment(db, input, "2026-09-28T12:02:00Z");
  const again = saveAssessment(db, input, "2026-09-28T12:03:00Z");
  expect(again.id).toBe(first.id);
  expect(first.confidence).toBeUndefined();
  expect(listProposals(db)[0]!.status).toBe("accepted");
  expect(getCompany(db, "acme")!.hypotheses[0]!.history).toHaveLength(1);
  expect(() => saveAssessment(db, { ...input, proposalId: undefined, evidenceIds: ["missing"] })).toThrow(/not recorded/);
});

test("a proposal becomes stale after another official assessment is saved", () => {
  const { db, evidence } = setup();
  const stale = proposal(db, evidence.id);
  saveAssessment(db, { companyId: "acme", hypothesisId: "moat", verdict: "neutral", reasoning: "Direct analyst revision",
    evidenceIds: [evidence.id], reviewedEvidenceIds: [evidence.id], openQuestions: [] }, "2026-09-28T12:02:00Z");
  expect(() => saveAssessment(db, { companyId: "acme", hypothesisId: "moat", proposalId: stale.id, verdict: "supports",
    reasoning: "Old proposal", evidenceIds: [evidence.id], reviewedEvidenceIds: [evidence.id], openQuestions: [] }, "2026-09-28T12:03:00Z")).toThrow(/stale/);
  expect(listProposals(db)[0]!.status).toBe("pending");
});

test("assessment input rejects malformed arrays and blank reasoning", () => {
  const { db, evidence } = setup();
  const base = { companyId: "acme", hypothesisId: "moat", verdict: "supports" as const, reasoning: "Reason",
    evidenceIds: [evidence.id], reviewedEvidenceIds: [evidence.id], openQuestions: [] };
  expect(() => saveAssessment(db, { ...base, reasoning: " " })).toThrow(/Invalid assessment contents/);
  expect(() => saveAssessment(db, { ...base, openQuestions: {} } as never)).toThrow(/Invalid assessment contents/);
  expect(() => saveAssessment(db, null as never)).toThrow(/company and hypothesis/);
});

const evaluated = (evidenceId: string) => async () => ({
  evaluation: {
    verdict: "supports" as const, confidence: 77, reasoning: "Provider reasoning", openQuestions: [],
    changeReason: "Initial recorded assessment", consideredEvidenceIds: [evidenceId], citedEvidenceIds: [evidenceId], decisiveEvidenceIds: [evidenceId], newClaims: [],
  },
  providerRunId: "fixture-run", rawOutput: { structured: { verdict: "supports" } }, grounding: [{ field: "verdict", citations: [] }],
});

test("Assess saves AI research directly without accepting an analyst assessment", async () => {
  const { db, evidence } = setup();
  const current = loadHypothesis(db, "acme", "moat")!;
  const created = await runAssess(db, current.company, current.hypothesis, undefined, evaluated(evidence.id));
  expect(created).toMatchObject({ origin: "agent", verdict: "supports" });
  expect(listProposals(db)).toHaveLength(0);
  expect(getCompany(db, "acme")!.hypotheses[0]).toMatchObject({ verdict: "untested", history: [] });

  const historical = loadResearchHypothesis(db, "acme", "moat", "2026-09-28")!;
  const reconstructed = await runAssess(db, historical.company, historical.hypothesis, "2026-09-28", evaluated(evidence.id));
  expect(reconstructed).toMatchObject({ origin: "reconstruction", targetDate: "2026-09-28" });
  const hypothesis = getCompany(db, "acme")!.hypotheses[0]!;
  expect(hypothesis.history).toEqual([]);
  expect(hypothesis.researchHistory).toHaveLength(2);
});
