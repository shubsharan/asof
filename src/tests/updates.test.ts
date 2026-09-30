import { test, expect } from "bun:test";
import { createDb } from "../db/schema";
import { createHypothesis, listCompanies, recordEvidence } from "../db/queries";
import { updatesFeed } from "../domain/updates";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme Security', 'Security software', 'acme.example')");
  createHypothesis(db, { id: "adoption", name: "Adoption", statement: "Enterprise adoption is accelerating" });

  recordEvidence(db, "acme", "adoption", [
    { title: "a", claim: "a", url: "https://a", publishedAt: "2026-02-01T08:00:00Z", type: "supports" },
    { title: "b", claim: "b", url: "https://b", publishedAt: "2026-02-01T17:00:00Z", type: "contradicts" },
  ], "search", "2026-09-20T00:00:00Z");
  recordEvidence(db, "acme", "adoption", [{ title: "c", claim: "c", url: "https://c", publishedAt: "2026-05-10" }], "monitor", "2026-09-21T00:00:00Z");
  return db;
}

test("one row per piece of evidence, newest first, each with its company and hypothesis", () => {
  const updates = updatesFeed(listCompanies(setup()));
  expect(updates.map((u) => [u.evidence.url, u.at.slice(0, 10), u.evidence.type])).toEqual([
    ["https://c", "2026-09-21", undefined],
    ["https://a", "2026-09-20", "supports"],
    ["https://b", "2026-09-20", "contradicts"],
  ]);
  expect(updates[0]).toMatchObject({
    company: { id: "acme", name: "Acme Security" },
    hypothesis: { id: "adoption", name: "Adoption", statement: "Enterprise adoption is accelerating" },
  });
});

test("the feed as of a past date shows only evidence known by then", () => {
  expect(updatesFeed(listCompanies(setup(), "2026-03-01"))).toEqual([]);
  expect(updatesFeed(listCompanies(setup(), "2026-09-20")).map((u) => u.evidence.url)).toEqual(["https://a", "https://b"]);
});

test("limit keeps the newest", () => {
  expect(updatesFeed(listCompanies(setup()), { limit: 1 }).map((u) => u.evidence.url)).toEqual(["https://c"]);
});

test("recorded date bounds are inclusive UTC days and filter before the limit", () => {
  const companies = listCompanies(setup());
  expect(updatesFeed(companies, { from: "2026-09-20", to: "2026-09-20" }).map((u) => u.evidence.url)).toEqual(["https://a", "https://b"]);
  expect(updatesFeed(companies, { from: "2026-09-20", to: "2026-09-20", limit: 1 }).map((u) => u.evidence.url)).toEqual(["https://a"]);
  expect(updatesFeed(companies, { from: "2026-09-21" }).map((u) => u.evidence.url)).toEqual(["https://c"]);
});
