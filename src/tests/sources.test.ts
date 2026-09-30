import { expect, test } from "bun:test";
import { createHypothesis, getCompany, groupEvidence, recordClaimBatch, recordEvidence, reviewEvidence, saveAssessment, setEvidenceRelationship, type SourceCaptureInput } from "../db/queries";
import { createDb } from "../db/schema";
import { loadHypothesis, runAssess } from "../research";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme', '', 'acme.example'), ('beta', 'Beta', '', 'beta.example')");
  createHypothesis(db, { id: "moat", name: "Moat", statement: "Moat strengthens" });
  return db;
}

const capture = (url: string, text: string, excerpt = "Exact source passage"): SourceCaptureInput => ({
  status: "retrieved", url, text, excerpt, retrievedAt: "2026-09-28T10:00:00Z", grounding: { native: true },
});

test("unchanged full text reuses one source version and does not refill evidence", () => {
  const db = setup();
  const url = "https://EXAMPLE.com/page?b=2&a=1#section";
  const first = recordEvidence(db, "acme", "moat", [{ title: "Page", claim: "First wording", url }], "search", "2026-09-28T10:00:00Z",
    new Map([[url, capture(url, "Full   page text")]]));
  const again = recordEvidence(db, "acme", "moat", [{ title: "Page", claim: "Model reworded the same page", url }], "search", "2026-09-29T10:00:00Z",
    new Map([[url, capture(url, "Full page text")]]));
  expect(first).toHaveLength(1);
  expect(again).toEqual([]);
  expect(db.query("SELECT count(*) n FROM source_versions").get()).toEqual({ n: 1 });
  expect(first[0]!.sourceVersion).toMatchObject({ status: "retrieved", excerpt: "Exact source passage", grounding: { native: true } });
});

test("changed full text creates a new immutable version and evidence report", () => {
  const db = setup();
  const url = "https://example.com/page";
  const old = recordEvidence(db, "acme", "moat", [{ title: "Page", claim: "Old claim", url }], "search", "2026-09-28T10:00:00Z",
    new Map([[url, capture(url, "Old page text")]]))[0]!;
  reviewEvidence(db, old.id, { decision: "relevant" }, "2026-09-28T10:01:00Z");
  saveAssessment(db, { companyId: "acme", hypothesisId: "moat", verdict: "supports", reasoning: "Original source",
    evidenceIds: [old.id], reviewedEvidenceIds: [old.id], openQuestions: [] }, "2026-09-28T10:02:00Z");
  const changed = recordEvidence(db, "acme", "moat", [{ title: "Page", claim: "New claim", url }], "search", "2026-09-29T10:00:00Z",
    new Map([[url, capture(url, "Changed page text")]]))[0]!;
  expect(changed.id).not.toBe(old.id);
  expect(changed.sourceVersionId).not.toBe(old.sourceVersionId);
  const evidence = getCompany(db, "acme", "2030-01-01")!.hypotheses[0]!.evidence;
  expect(evidence.map((item) => item.sourceVersion!.text)).toEqual(["Old page text", "Changed page text"]);
  const hypothesis = getCompany(db, "acme", "2030-01-01")!.hypotheses[0]!;
  expect(hypothesis.history[0]!.evidenceIds).toEqual([old.id]);
  expect(evidence.find((item) => item.id === old.id)!.sourceVersion!.text).toBe("Old page text");
  expect(evidence.find((item) => item.id === changed.id)!.review).toBeUndefined();
  expect(hypothesis.reviewCounts!.unreviewed).toBe(1);
});

test("retrieval failure keeps a verification gap and deduplicates the same observation across changing errors", () => {
  const db = setup();
  const url = "https://example.com/unavailable";
  const unavailable = (error: string): SourceCaptureInput => ({ status: "unavailable", url, retrievedAt: "2026-09-28T10:00:00Z", error });
  const first = recordEvidence(db, "acme", "moat", [{ title: "Report", claim: "Reported observation", url }], "agent", undefined,
    new Map([[url, unavailable("timeout")]]));
  const again = recordEvidence(db, "acme", "moat", [{ title: "Report", claim: "Reported   observation", url }], "agent", undefined,
    new Map([[url, unavailable("blocked")]]));
  expect(first[0]).toMatchObject({ verificationGap: "timeout", sourceVersion: { status: "unavailable" } });
  expect(again).toEqual([]);
});

test("relationship correction and grouping preserve reports while changing development counts", () => {
  const db = setup();
  const reports = recordEvidence(db, "acme", "moat", [
    { title: "A", claim: "a", url: "https://a" }, { title: "B", claim: "b", url: "https://b" },
  ], "monitor");
  expect(getCompany(db, "acme")!.hypotheses[0]).toMatchObject({ reportCount: 2, developmentCount: 2 });
  expect(setEvidenceRelationship(db, reports[0]!.id, "customer-partner")).toMatchObject({ relationship: "customer-partner", relationshipAutomated: false });
  const grouped = groupEvidence(db, { evidenceIds: reports.map((item) => item.id) });
  expect(new Set(grouped.map((item) => item.groupId)).size).toBe(1);
  expect(getCompany(db, "acme")!.hypotheses[0]).toMatchObject({ reportCount: 2, developmentCount: 1 });
  groupEvidence(db, { evidenceIds: [reports[0]!.id], groupId: null });
  expect(getCompany(db, "acme")!.hypotheses[0]!.developmentCount).toBe(2);

  const other = recordEvidence(db, "beta", "moat", [{ title: "C", claim: "c", url: "https://c" }], "search")[0]!;
  expect(() => groupEvidence(db, { evidenceIds: [reports[0]!.id, other.id] })).toThrow(/share a company and hypothesis/);
});

test("Assess reports only evidence it added, excluding an arrival during generation", async () => {
  const db = setup();
  const loaded = loadHypothesis(db, "acme", "moat")!;
  const agentUrl = "https://agent-new";
  const result = await runAssess(db, loaded.company, loaded.hypothesis, undefined, async () => {
    recordEvidence(db, "acme", "moat", [{ title: "Concurrent", claim: "other job", url: "https://concurrent" }], "monitor");
    return { evaluation: { verdict: "supports", confidence: 70, reasoning: "Reason", changeReason: "Initial recorded assessment", openQuestions: [], consideredEvidenceIds: ["new"], citedEvidenceIds: ["new"], decisiveEvidenceIds: ["new"],
      newClaims: [{ ref: "new", title: "Agent", claim: "agent job", excerpt: "Agent page", relevanceReason: "Tests moat", url: agentUrl, type: "supports" }] },
      providerRunId: "fixture", rawOutput: {}, grounding: [{ field: "newClaims[0]", citations: [{ url: agentUrl }] }] };
  }, async (urls) => new Map(urls.map((url) => [url, capture(url, "Agent page")])));
  expect(result.addedEvidenceIds).toHaveLength(1);
  expect(getCompany(db, "acme")!.hypotheses[0]!.evidence).toHaveLength(2);
});

test("Assess resolves rediscovered URLs to the exact captured source version", async () => {
  const db = setup();
  const url = "https://example.com/changing";
  const old = recordClaimBatch(db, "acme", "moat", [{ title: "Page", claim: "Old wording", excerpt: "Version one", relevanceReason: "Tests moat", type: "supports", url }], "search", undefined,
    new Map([[url, capture(url, "Version one")]])).claims[0]!;
  reviewEvidence(db, old.id, { decision: "relevant" });

  const evaluate = (claim: string, excerpt: string) => async () => ({ evaluation: { verdict: "supports" as const, confidence: 70, reasoning: "Reason", changeReason: "Updated", openQuestions: [],
    consideredEvidenceIds: ["new"], citedEvidenceIds: ["new"], decisiveEvidenceIds: ["new"], newClaims: [{ ref: "new", title: "Page", claim, excerpt, relevanceReason: "Tests moat", url, type: "supports" as const }] },
    providerRunId: crypto.randomUUID(), rawOutput: {}, grounding: [{ field: "newClaims[0]", citations: [{ url }] }] });

  const first = loadHypothesis(db, "acme", "moat")!;
  const unchanged = await runAssess(db, first.company, first.hypothesis, undefined, evaluate("Old wording", "Version one"),
    async () => new Map([[url, capture(url, "Version one")]]));
  expect(unchanged.evidenceIds).toEqual([old.id]);
  expect(unchanged.addedEvidenceIds).toEqual([]);

  const next = loadHypothesis(db, "acme", "moat")!;
  const changed = await runAssess(db, next.company, next.hypothesis, undefined, evaluate("Updated fact", "Version two"),
    async () => new Map([[url, capture(url, "Version two")]]));
  expect(changed.evidenceIds).toHaveLength(1);
  expect(changed.evidenceIds[0]).not.toBe(old.id);
  expect(changed.addedEvidenceIds).toEqual(changed.evidenceIds);
});
