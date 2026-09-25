import { test, expect } from "bun:test";
import { createDb } from "../db/schema";
import {
    assessHypothesis,
    createHypothesis,
    getCompany,
    listPortfolio,
    recordEvidence,
    type NewEvidence,
} from "../db/queries";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies VALUES ('acme', 'Acme Security', 'Security software')");
  createHypothesis(db, { id: "adoption", companyId: "acme", statement: "Enterprise adoption is accelerating" });
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
  expect(adoption(db)).toMatchObject({ confidence: undefined, status: "untested" });

  recordEvidence(db, "adoption", [item("https://a", "supports", "2026-09-01")], "search", "2026-09-20");
  expect(adoption(db)).toMatchObject({ confidence: undefined, status: "untested", history: [] });
  expect(adoption(db).evidence).toHaveLength(1);
});

test("recordEvidence skips URLs already recorded for the hypothesis", () => {
  const db = setup();
  recordEvidence(db, "adoption", [item("https://a", "supports")], "search", "2026-09-20");
  const again = recordEvidence(db, "adoption", [item("https://a", "supports"), item("https://b", "contradicts")], "monitor");
  expect(again.map((e) => e.url)).toEqual(["https://b"]);
});

test("assessHypothesis records the assessor's judgement, citing evidence", () => {
  const db = setup();
  const [a] = recordEvidence(db, "adoption", [item("https://a", "supports", "2026-02-01")], "search", "2026-02-01");
  assessHypothesis(db, "adoption", { confidence: 74, status: "supported", reasoning: "Early wins", evidenceIds: [a!.id] }, "2026-03-01");

  expect(adoption(db)).toMatchObject({ confidence: 74, status: "supported" });
  expect(adoption(db, "2026-02-15")).toMatchObject({ status: "untested" });
});

test("assessHypothesis refuses assessments without recorded evidence", () => {
  const db = setup();
  const assess = (evidenceIds: string[]) =>
    assessHypothesis(db, "adoption", { confidence: 60, status: "mixed", reasoning: "", evidenceIds });
  expect(() => assess([])).toThrow(/must cite evidence/);
  expect(() => assess(["made-up"])).toThrow(/not recorded/);
  expect(adoption(db).history).toEqual([]);
});

test("listPortfolio counts hypotheses and this week's assessments", () => {
  const db = setup();
  const [a] = recordEvidence(db, "adoption", [item("https://a", "supports")], "search", "2026-09-20");
  assessHypothesis(db, "adoption", { confidence: 70, status: "supported", reasoning: "", evidenceIds: [a!.id] }, "2026-09-20");
  expect(listPortfolio(db, "2026-09-24")).toEqual([
    { id: "acme", name: "Acme Security", hypothesisCount: 1, changesThisWeek: 1 },
  ]);
});
