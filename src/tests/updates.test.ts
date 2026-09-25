import { test, expect } from "bun:test";
import { createDb } from "../db/schema";
import { assessHypothesis, createHypothesis, listCompanies, recordEvidence } from "../db/queries";
import { createRun, failRun, listRuns } from "../db/runs";
import { updatesFeed } from "../domain/updates";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme Security', 'Security software', 'acme.example')");
  createHypothesis(db, { id: "adoption", companyId: "acme", lens: "adoption", statement: "Enterprise adoption is accelerating" });

  const [a, b] = recordEvidence(db, "adoption", [
    { title: "a", claim: "a", url: "https://a", publishedAt: "2026-02-01T08:00:00Z", type: "supports" },
    { title: "b", claim: "b", url: "https://b", publishedAt: "2026-02-01T17:00:00Z", type: "contradicts" },
  ], "search", "2026-09-20T00:00:00Z");
  const [c] = recordEvidence(db, "adoption", [{ title: "c", claim: "c", url: "https://c", publishedAt: "2026-05-10" }], "monitor", "2026-09-20T00:00:00Z");
  assessHypothesis(db, "adoption", { confidence: 70, status: "supported", reasoning: "", evidenceIds: [a!.id], openQuestions: [] }, "2026-03-01");
  assessHypothesis(db, "adoption", { confidence: 55, status: "mixed", reasoning: "", evidenceIds: [b!.id, c!.id], openQuestions: [] }, "2026-06-04");
  return db;
}

const feed = (db: ReturnType<typeof setup>, asOf?: string) => updatesFeed(listCompanies(db, asOf), listRuns(db, { failed: true }), { asOf });

test("assessments carry the assessment before them, starting from untested", () => {
  const assessments = feed(setup()).filter((u) => u.kind === "assessment");
  expect(assessments.map((u) => [u.at, u.before, u.after])).toEqual([
    ["2026-06-04", { confidence: 70, status: "supported" }, { confidence: 55, status: "mixed" }],
    ["2026-03-01", { confidence: undefined, status: "untested" }, { confidence: 70, status: "supported" }],
  ]);
});

test("evidence is batched per hypothesis per day it became knowable, newest first", () => {
  const updates = feed(setup());
  expect(updates.map((u) => [u.kind, u.at.slice(0, 10)])).toEqual([
    ["assessment", "2026-06-04"],
    ["evidence", "2026-05-10"],
    ["assessment", "2026-03-01"],
    ["evidence", "2026-02-01"],
  ]);
  const feb = updates.at(-1)!;
  expect(feb.kind === "evidence" && feb.evidence.map((e) => e.url)).toEqual(["https://b", "https://a"]);
});

test("the feed as of a past date shows only what was known by then", () => {
  const db = setup();
  const run = createRun(db, { kind: "monitor", companyId: "acme", trigger: "schedule" }, "2026-09-21T00:00:00Z");
  failRun(db, run.id, "Exa is down", "2026-09-21T00:01:00Z");

  expect(feed(db, "2026-03-01").map((u) => [u.kind, u.at.slice(0, 10)])).toEqual([
    ["assessment", "2026-03-01"],
    ["evidence", "2026-02-01"],
  ]);
  expect(feed(db)[0]).toMatchObject({ kind: "run-failed", run: { error: "Exa is down" } });
});
