import { expect, test } from "bun:test";
import { createHypothesis, getCompanyData, recordClaimBatch, recordEvidence } from "../db/queries";
import { createDb } from "../db/schema";
import type { EvaluationResult } from "../exa/agent";
import { loadHypothesis, runAssess, runResearch } from "../research";

const source = (url: string, text: string) => ({ status: "retrieved" as const, url, text, retrievedAt: "2026-09-30T10:00:00Z" });
const claim = (url: string, fact: string, excerpt = fact) => ({ url, title: "Source", claim: fact, excerpt, relevanceReason: "Bears on the moat", type: "supports" as const });
const setup = () => {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme', '', 'acme.example')");
  createHypothesis(db, { id: "moat", name: "Moat", statement: "Retention strengthens the moat" });
  return db;
};
const result = (newClaims: EvaluationResult["evaluation"]["newClaims"], citedEvidenceIds: string[], consideredEvidenceIds = citedEvidenceIds): EvaluationResult => ({
  evaluation: { verdict: "supports", confidence: 76, reasoning: "The cited passages support retention", changeReason: "Initial recorded assessment",
    openQuestions: ["Does retention persist?"], consideredEvidenceIds, citedEvidenceIds, decisiveEvidenceIds: citedEvidenceIds,
    newClaims }, providerRunId: "run-1", rawOutput: { structured: true },
  grounding: newClaims.map((item, index) => ({ field: `newClaims[${index}]`, citations: [{ url: item.url }] })),
});

test("search stores multiple claims per page and rejects a later invented addition to the same version", async () => {
  const db = setup();
  const url = "https://acme.example/report";
  const items = [claim(url, "Retention rose to 90%."), claim(url, "Churn fell to 2%."), claim(url, "Retention rose to 90%.")];
  const loaded = loadHypothesis(db, "acme", "moat")!;
  const capture = async () => new Map([[url, source(url, "Retention rose to 90%. Churn fell to 2%.")]]);
  const search = async () => items;
  expect(await runResearch(db, loaded.company, loaded.hypothesis, undefined, capture, search)).toHaveLength(2);
  expect(await runResearch(db, loaded.company, loaded.hypothesis, undefined, capture, search)).toEqual([]);
  await expect(runResearch(db, loaded.company, loaded.hypothesis, undefined, capture,
    async () => [claim(url, "A third fact.", "Churn fell to 2%.")])).rejects.toThrow(/did not resolve/);
  expect(getCompanyData(db, "acme")!.hypotheses[0]!.evidence.filter((item) => item.kind === "claim")).toHaveLength(2);
  db.close();
});

test("Agent combines saved and freshly captured claims from the same page version", async () => {
  const db = setup();
  const url = "https://acme.example/report";
  const text = "Retention rose to 90%. Churn fell to 2%.";
  const lead = recordEvidence(db, "acme", "moat", [{ title: "Report", claim: "Monitor lead", url }], "monitor", undefined,
    new Map([[url, source(url, text)]]))[0]!;
  const loaded = loadHypothesis(db, "acme", "moat")!;
  const assessment = await runAssess(db, loaded.company, loaded.hypothesis, undefined,
    async () => result([
      { ...claim(url, "Retention rose to 90%."), ref: "saved", sourceEvidenceId: lead.id },
      { ...claim(url, "Churn fell to 2%."), ref: "fresh" },
    ], ["saved", "fresh"]),
    async () => new Map([[url, source(url, text)]]));
  expect(assessment.evidenceIds).toHaveLength(2);
  expect(assessment.addedEvidenceIds).toHaveLength(2);
  const claims = getCompanyData(db, "acme")!.hypotheses[0]!.evidence.filter((item) => item.kind === "claim");
  expect(claims).toHaveLength(2);
  expect(new Set(claims.map((item) => item.sourceVersionId)).size).toBe(1);
  db.close();
});

test("a missing passage keeps its page as a lead while another page's claims survive", async () => {
  const db = setup();
  const good = "https://acme.example/good";
  const bad = "https://acme.example/bad";
  const loaded = loadHypothesis(db, "acme", "moat")!;
  await expect(runResearch(db, loaded.company, loaded.hypothesis, undefined,
    async () => new Map([[good, source(good, "Retention rose.")], [bad, source(bad, "Only the first fact appears.")]]),
    async () => [claim(good, "Retention rose."), claim(bad, "First fact", "Only the first fact appears."), claim(bad, "Missing fact")],
  )).rejects.toThrow(/lack captured source passages/);
  const evidence = getCompanyData(db, "acme")!.hypotheses[0]!.evidence;
  expect(evidence.filter((item) => item.kind === "claim").map((item) => item.url)).toEqual([good]);
  expect(evidence.filter((item) => item.kind === "lead").map((item) => item.url)).toEqual([bad]);
  db.close();
});

test("Agent extracts from a saved lead version and records exact IDs and provider lineage", async () => {
  const db = setup();
  const url = "https://acme.example/saved";
  const lead = recordEvidence(db, "acme", "moat", [{ title: "Saved", claim: "Monitor lead", url }], "monitor", undefined,
    new Map([[url, source(url, "Retention rose to 90%.")]]))[0]!;
  const loaded = loadHypothesis(db, "acme", "moat")!;
  let calls = 0;
  const first = await runAssess(db, loaded.company, loaded.hypothesis, undefined, async (_company, input) => {
    expect(input.evidence.map((item) => item.id)).toEqual([lead.id]);
    return result([{ ...claim(url, "Retention rose to 90%."), ref: "new-1", sourceEvidenceId: lead.id }], ["new-1"]);
  }, async () => { calls++; return new Map(); });
  expect(calls).toBe(0);
  expect(first).toMatchObject({ origin: "agent", providerRunId: "run-1", inputEvidenceIds: [lead.id], previousAssessmentId: undefined });
  expect(first.evidenceIds).toEqual(first.decisiveEvidenceIds ?? []);
  expect(first.consideredEvidenceIds).toEqual(first.evidenceIds);
  const secondInput = loadHypothesis(db, "acme", "moat")!;
  const second = await runAssess(db, secondInput.company, secondInput.hypothesis, undefined, async (_company, input) => {
    expect(input.researchHistory?.[0]?.openQuestions).toEqual(["Does retention persist?"]);
    return result([], [first.evidenceIds[0]!]);
  }, async () => new Map());
  expect(second.previousAssessmentId).toBe(first.id);
  expect(second.inputEvidenceIds).toContain(lead.id);
  expect(second.consideredEvidenceIds).toContain(first.evidenceIds[0]);
  db.close();
});

test("an invalid new passage fails the assessment but keeps valid claims and leads for retry", async () => {
  const db = setup();
  const loaded = loadHypothesis(db, "acme", "moat")!;
  const good = "https://acme.example/good";
  const bad = "https://acme.example/bad";
  await expect(runAssess(db, loaded.company, loaded.hypothesis, undefined,
    async () => result([{ ...claim(good, "Retention rose."), ref: "good" }, { ...claim(bad, "Churn fell."), ref: "bad" }], ["good", "bad"]),
    async () => new Map([[good, source(good, "Retention rose.")], [bad, source(bad, "No passage here.")]]),
  )).rejects.toThrow(/lack captured source passages/);
  const hypothesis = getCompanyData(db, "acme")!.hypotheses[0]!;
  expect(hypothesis.researchHistory).toEqual([]);
  expect(new Set(hypothesis.evidence.map((item) => `${item.url}:${item.kind}`))).toEqual(new Set([`${good}:claim`, `${bad}:lead`]));
  db.close();
});
