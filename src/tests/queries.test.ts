import { test, expect } from "bun:test";
import { createDb, migrate } from "../db/schema";
import {
    assessHypothesis,
    createHypothesis,
    getCompany,
    recordEvidence,
    type NewEvidence,
} from "../db/queries";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme Security', 'Security software', 'acme.example')");
  createHypothesis(db, { id: "acme-adoption", companyId: "acme", lens: "adoption", statement: "Enterprise adoption is accelerating" });
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

  recordEvidence(db, "acme-adoption", [item("https://a", "supports", "2026-09-01")], "search", "2026-09-20");
  expect(adoption(db)).toMatchObject({ confidence: undefined, status: "untested", history: [] });
  expect(adoption(db).evidence).toHaveLength(1);
});

test("evidence nobody has classified reads back with no type, not neutral", () => {
  const db = setup();
  recordEvidence(db, "acme-adoption", [{ title: "t", claim: "c", url: "https://a" }], "monitor", "2026-09-20");
  expect(adoption(db).evidence[0]!.type).toBeUndefined();
});

test("recordEvidence skips URLs already recorded for the hypothesis", () => {
  const db = setup();
  recordEvidence(db, "acme-adoption", [item("https://a", "supports")], "search", "2026-09-20");
  const again = recordEvidence(db, "acme-adoption", [item("https://a", "supports"), item("https://b", "contradicts")], "monitor");
  expect(again.map((e) => e.url)).toEqual(["https://b"]);
});

test("assessHypothesis records the assessor's judgement, citing evidence", () => {
  const db = setup();
  const [a] = recordEvidence(db, "acme-adoption", [item("https://a", "supports", "2026-02-01")], "search", "2026-02-01");
  assessHypothesis(db, "acme-adoption", { confidence: 74, status: "supported", reasoning: "Early wins", evidenceIds: [a!.id], openQuestions: ["Retention?"] }, "2026-03-01");

  expect(adoption(db)).toMatchObject({ confidence: 74, status: "supported" });
  expect(adoption(db).history[0]!.openQuestions).toEqual(["Retention?"]);
  expect(adoption(db, "2026-02-15")).toMatchObject({ status: "untested" });
});

test("assessHypothesis refuses assessments without recorded evidence", () => {
  const db = setup();
  const assess = (evidenceIds: string[]) =>
    assessHypothesis(db, "acme-adoption", { confidence: 60, status: "mixed", reasoning: "", evidenceIds, openQuestions: [] });
  expect(() => assess([])).toThrow(/must cite evidence/);
  expect(() => assess(["made-up"])).toThrow(/not recorded/);
  expect(adoption(db).history).toEqual([]);
});

test("getCompany returns each hypothesis's lens", () => {
  expect(adoption(setup())).toMatchObject({ id: "acme-adoption", lens: "adoption" });
});

test("migrate adds the lens column to an older database and recovers lenses from ids", () => {
  const db = createDb(":memory:");
  db.run("DROP TABLE hypotheses");
  db.run("CREATE TABLE hypotheses (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, statement TEXT NOT NULL)");
  db.run("INSERT INTO hypotheses VALUES ('exa-adoption', 'exa', 'Adoption'), ('odd', 'exa', 'Odd one')");
  migrate(db);
  expect(db.query<{ id: string; lens: string }, []>("SELECT id, lens FROM hypotheses ORDER BY id").all()).toEqual([
    { id: "exa-adoption", lens: "adoption" },
    { id: "odd", lens: "odd" },
  ]);
  migrate(db); // idempotent
});
