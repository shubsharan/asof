import { expect, test } from "bun:test";
import { createHypothesis, getCompany, recordEvidence, reviewEvidence, saveAssessment } from "../db/queries";
import { createDb } from "../db/schema";
import { loadHypothesis, runAssess } from "../research";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme', '', 'acme.example')");
  createHypothesis(db, { id: "moat", name: "Moat", statement: "Moat strengthens" });
  const [relevant, irrelevant, disputed] = recordEvidence(db, "acme", "moat", [
    { title: "Relevant", claim: "r", url: "https://relevant", type: "supports" },
    { title: "Irrelevant", claim: "i", url: "https://irrelevant", type: "neutral" },
    { title: "Disputed", claim: "d", url: "https://disputed", type: "contradicts" },
  ], "search", "2026-09-28T10:00:00Z");
  reviewEvidence(db, relevant!.id, { decision: "relevant" }, "2026-09-28T10:01:00Z");
  reviewEvidence(db, irrelevant!.id, { decision: "irrelevant", note: "Wrong company" }, "2026-09-28T10:02:00Z");
  reviewEvidence(db, disputed!.id, { decision: "disputed", note: "Publisher claim is contested" }, "2026-09-28T10:03:00Z");
  return { db, relevant: relevant!, irrelevant: irrelevant!, disputed: disputed! };
}

test("reviews append history and rewind to the decision known at the time", () => {
  const { db, disputed } = setup();
  reviewEvidence(db, disputed.id, { decision: "relevant", note: "Confirmed" }, "2026-09-29T10:00:00Z");
  expect(getCompany(db, "acme", "2026-09-28")!.hypotheses[0]!.evidence.find((e) => e.id === disputed.id)!.review)
    .toMatchObject({ decision: "disputed", note: "Publisher claim is contested" });
  expect(getCompany(db, "acme", "2026-09-29")!.hypotheses[0]!.evidence.find((e) => e.id === disputed.id)!.review)
    .toMatchObject({ decision: "relevant", note: "Confirmed" });
});

test("saving captures review IDs and a later decision makes evidence pending again", () => {
  const { db, relevant } = setup();
  const saved = saveAssessment(db, { companyId: "acme", hypothesisId: "moat", verdict: "supports", reasoning: "Analyst view",
    evidenceIds: [relevant.id], reviewedEvidenceIds: [relevant.id], openQuestions: [] }, "2026-09-28T11:00:00Z");
  expect(saved.reviewedEvidenceReviewIds).toHaveLength(1);
  expect(getCompany(db, "acme")!.hypotheses[0]!.reviewCounts!.pending).toBe(1); // disputed remains pending
  reviewEvidence(db, relevant.id, { decision: "disputed", note: "New conflict" }, "2026-09-28T12:00:00Z");
  expect(getCompany(db, "acme")!.hypotheses[0]!.reviewCounts!.pending).toBe(2);
  expect(getCompany(db, "acme", "2026-09-28T11:30:00Z")!.hypotheses[0]!.reviewCounts!.pending).toBe(1);
});

test("later assessments do not requeue evidence incorporated by an earlier assessment", () => {
  const { db, relevant, disputed } = setup();
  saveAssessment(db, { companyId: "acme", hypothesisId: "moat", verdict: "supports", reasoning: "First",
    evidenceIds: [relevant.id], reviewedEvidenceIds: [relevant.id], openQuestions: [] }, "2026-09-28T11:00:00Z");
  saveAssessment(db, { companyId: "acme", hypothesisId: "moat", verdict: "neutral", reasoning: "Second",
    evidenceIds: [disputed.id], reviewedEvidenceIds: [disputed.id], openQuestions: [] }, "2026-09-28T12:00:00Z");
  expect(getCompany(db, "acme")!.hypotheses[0]!.reviewCounts!.pending).toBe(0);
});

test("assessment citations must be considered and cannot be irrelevant", () => {
  const { db, relevant, irrelevant } = setup();
  expect(() => saveAssessment(db, { companyId: "acme", hypothesisId: "moat", verdict: "supports", reasoning: "Analyst view",
    evidenceIds: [relevant.id], reviewedEvidenceIds: [], openQuestions: [] })).toThrow(/included in reviewed/);
  expect(() => saveAssessment(db, { companyId: "acme", hypothesisId: "moat", verdict: "supports", reasoning: "Analyst view",
    evidenceIds: [irrelevant.id], reviewedEvidenceIds: [irrelevant.id], openQuestions: [] })).toThrow(/Irrelevant/);
});

test("Agent receives relevant and disputed evidence, while evidence arriving during generation stays pending", async () => {
  const { db, relevant, irrelevant, disputed } = setup();
  let inputIds: string[] = [];
  const loaded = loadHypothesis(db, "acme", "moat")!;
  const proposal = await runAssess(db, loaded.company, loaded.hypothesis, undefined, async (_company, hypothesis) => {
    inputIds = hypothesis.evidence.map((e) => e.id);
    const late = recordEvidence(db, "acme", "moat", [{ title: "Late", claim: "late", url: "https://late", type: "supports" }], "monitor", "2026-09-28T10:04:00Z")[0]!;
    reviewEvidence(db, late.id, { decision: "relevant" }, "2026-09-28T10:05:00Z");
    return { evaluation: { verdict: "neutral", confidence: 60, reasoning: "Mixed", changeReason: "Initial recorded assessment", openQuestions: [],
      consideredEvidenceIds: ["r", "d"], citedEvidenceIds: ["r", "d"], decisiveEvidenceIds: ["r", "d"], newClaims: [
        { ref: "r", title: "Relevant", claim: "Relevant fact", excerpt: "Relevant fact", relevanceReason: "Bears on moat", url: relevant.url, type: "supports" as const },
        { ref: "d", title: "Disputed", claim: "Disputed fact", excerpt: "Disputed fact", relevanceReason: "Bears on moat", url: disputed.url, type: "contradicts" as const },
      ] },
      providerRunId: "fixture", rawOutput: {}, grounding: [] };
  }, async (urls) => new Map(urls.map((url) => [url, { status: "retrieved" as const, url, text: url === relevant.url ? "Relevant fact" : "Disputed fact", retrievedAt: "2026-09-28T10:05:00Z" }])));
  expect(new Set(inputIds)).toEqual(new Set([relevant.id, disputed.id]));
  expect(proposal.evidenceIds).toHaveLength(2);
  expect(proposal.evidenceIds).not.toContain(relevant.id);
  expect(getCompany(db, "acme")!.hypotheses[0]!.reviewCounts!.pending).toBe(3);
});

test("Assess rejects citations to irrelevant evidence", async () => {
  const { db, irrelevant } = setup();
  const loaded = loadHypothesis(db, "acme", "moat")!;
  await expect(runAssess(db, loaded.company, loaded.hypothesis, undefined, async () => ({
    evaluation: { verdict: "neutral", confidence: 60, reasoning: "Mixed", changeReason: "Initial recorded assessment", openQuestions: [], consideredEvidenceIds: [irrelevant.id], citedEvidenceIds: [irrelevant.id], decisiveEvidenceIds: [], newClaims: [] },
    providerRunId: "fixture", rawOutput: {}, grounding: [],
  }))).rejects.toThrow(/outside its frozen passage-backed input/);
});
