import { test, expect } from "bun:test";
import { createDb } from "../db/schema";
import {
    createHypothesis,
    getCompany,
    listHypotheses,
    recordEvidence,
    reviewEvidence,
    saveAssessment,
    type NewEvidence,
} from "../db/queries";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme Security', 'Security software', 'acme.example')");
  createHypothesis(db, { id: "adoption", name: "Adoption", statement: "Enterprise adoption is accelerating" });
  return db;
}

const item = (url: string, type: NewEvidence["type"], publishedAt?: string): NewEvidence => ({
  title: url,
  claim: url,
  url,
  publishedAt,
  type,
});

const adoption = (db: ReturnType<typeof setup>, asOf = "2026-09-24") => getCompany(db, "acme", asOf)!.hypotheses[0]!;

test("a new hypothesis is untested, and evidence alone does not assess it", () => {
  const db = setup();
  expect(adoption(db)).toMatchObject({ confidence: undefined, verdict: "untested" });

  recordEvidence(db, "acme", "adoption", [item("https://a", "supports", "2026-09-01")], "search", "2026-09-20");
  expect(adoption(db)).toMatchObject({ confidence: undefined, verdict: "untested", history: [] });
  expect(adoption(db).evidence).toHaveLength(1);
});

test("evidence nobody has classified reads back with no type, not neutral", () => {
  const db = setup();
  recordEvidence(db, "acme", "adoption", [{ title: "t", claim: "c", url: "https://a" }], "monitor", "2026-09-20");
  expect(adoption(db).evidence[0]!.type).toBeUndefined();
});

test("recordEvidence skips URLs already recorded for the company's hypothesis", () => {
  const db = setup();
  recordEvidence(db, "acme", "adoption", [item("https://a", "supports")], "search", "2026-09-20");
  const again = recordEvidence(db, "acme", "adoption", [item("https://a", "supports"), item("https://b", "contradicts")], "monitor");
  expect(again.map((e) => e.url)).toEqual(["https://b"]);
});

test("saveAssessment records the analyst's judgement without model confidence", () => {
  const db = setup();
  const [a] = recordEvidence(db, "acme", "adoption", [item("https://a", "supports", "2026-02-01")], "search", "2026-02-01");
  reviewEvidence(db, a!.id, { decision: "relevant" }, "2026-02-02");
  saveAssessment(db, { companyId: "acme", hypothesisId: "adoption", verdict: "supports", reasoning: "Early wins", evidenceIds: [a!.id], reviewedEvidenceIds: [a!.id], openQuestions: ["Retention?"] }, "2026-03-01");

  expect(adoption(db)).toMatchObject({ verdict: "supports", confidence: undefined });
  expect(adoption(db).history[0]!.openQuestions).toEqual(["Retention?"]);
  expect(adoption(db, "2026-02-15")).toMatchObject({ verdict: "untested" });
});

test("saveAssessment refuses assessments without recorded evidence", () => {
  const db = setup();
  const assess = (evidenceIds: string[]) =>
    saveAssessment(db, { companyId: "acme", hypothesisId: "adoption", verdict: "neutral", reasoning: "Reason", evidenceIds, reviewedEvidenceIds: evidenceIds, openQuestions: [] });
  expect(() => assess([])).toThrow(/must cite evidence/);
  expect(() => assess(["made-up"])).toThrow(/not recorded/);
  expect(adoption(db).history).toEqual([]);
});

test("every company is tracked on every portfolio hypothesis, with its own evidence and assessments", () => {
  const db = setup();
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('beta', 'Beta', '', 'beta.example')");
  recordEvidence(db, "acme", "adoption", [item("https://a", "supports")], "search", "2026-09-20");
  const [b] = recordEvidence(db, "beta", "adoption", [item("https://a", "contradicts")], "search", "2026-09-20"); // same URL, other company
  expect(b).toBeDefined();
  expect(() => saveAssessment(db, { companyId: "acme", hypothesisId: "adoption", verdict: "supports", reasoning: "Reason", evidenceIds: [b!.id], reviewedEvidenceIds: [b!.id], openQuestions: [] })).toThrow(/not recorded/);

  expect(listHypotheses(db)).toEqual([{ id: "adoption", name: "Adoption", statement: "Enterprise adoption is accelerating" }]);
  const beta = getCompany(db, "beta")!.hypotheses;
  expect(beta.map((h) => [h.id, h.verdict, h.evidence.map((e) => e.type)])).toEqual([["adoption", "untested", ["contradicts"]]]);
});
