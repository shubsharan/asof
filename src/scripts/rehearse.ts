import { resolve } from "node:path";
import { createDb } from "../db/schema";
import { createHypothesis, getCompanyData, recordClaimBatch, recordEvidence } from "../db/queries";
import { runAssess } from "../research";
import type { EvaluationResult } from "../exa/agent";

const requested = process.argv[2];
if (!requested) throw new Error("Usage: bun run rehearse <new-disposable-database.sqlite>");
const path = resolve(requested);
if (await Bun.file(path).exists()) throw new Error("Rehearsal requires a new database path; existing files are never replaced");
const db = createDb(path);
const yesterday = new Date(Date.now() - 86_400_000).toISOString();
const earlier = new Date(Date.now() - 2 * 86_400_000).toISOString();
const url = "https://fixture.example/adoption";
const initialText = "The service has 100 paying customers. No comparable prior period was reported.";
const updatedText = "Paying customers grew from 100 to 140 to 200 across three consecutive months. Free accounts are excluded in all three months.";

try {
  db.run("INSERT INTO companies (id,name,description,domain) VALUES (?,?,?,?)", ["fixture", "Fixture rehearsal", "Synthetic sources and assessments for a provider-free walkthrough. No company facts or live research.", "fixture.example"]);
  createHypothesis(db, { id: "adoption", name: "Adoption", statement: "Developer and enterprise adoption is accelerating" });
  const first = recordClaimBatch(db, "fixture", "adoption", [{ title: "Fixture customer report", claim: "The service reports 100 paying customers.", url,
    excerpt: "The service has 100 paying customers.", type: "neutral", relevanceReason: "A single observation cannot establish acceleration.", publishedAt: earlier }], "search", earlier,
    new Map([[url, { status: "retrieved", url, text: initialText, retrievedAt: earlier }]]));
  const company = getCompanyData(db, "fixture")!;
  const firstResult: EvaluationResult = { providerRunId: "fixture-first", rawOutput: { fixture: true }, evaluation: {
    verdict: "neutral", confidence: 80, reasoning: "Fixture rehearsal. One reported customer count does not establish accelerating adoption.",
    changeReason: "Initial recorded assessment in this synthetic rehearsal.", openQuestions: ["Do comparable customer counts show increasing growth?"],
    consideredEvidenceIds: first.claims.map((e) => e.id), citedEvidenceIds: first.claims.map((e) => e.id), decisiveEvidenceIds: first.claims.map((e) => e.id), newClaims: [],
  } };
  const initial = await runAssess(db, company, company.hypotheses[0]!, undefined, async () => firstResult, async () => new Map());
  // Fixture dates make the two recorded steps visible on separate chart days.
  db.run("UPDATE research_assessments SET recorded_at = ? WHERE id = ?", [yesterday, initial.id]);
  recordEvidence(db, "fixture", "adoption", [{ title: "Fixture monitor update", claim: "A new report contains comparable monthly customer counts.", url }], "monitor");
  const next = getCompanyData(db, "fixture")!;
  const finalResult: EvaluationResult = { providerRunId: "fixture-second", rawOutput: { fixture: true }, grounding: [{ field: "newClaims", citations: [{ url }] }], evaluation: {
    verdict: "supports", confidence: 70, reasoning: "Fixture rehearsal. Comparable customer counts show net additions increasing from 40 to 60. This supports acceleration over the observed periods, with a short observation window.",
    changeReason: "Comparable monthly counts now support acceleration; the earlier single count could not establish a trend.", openQuestions: ["Does increasing growth persist over the next quarter?"],
    consideredEvidenceIds: [...first.claims.map((e) => e.id), "counts", "basis"], citedEvidenceIds: ["counts", "basis"], decisiveEvidenceIds: ["counts", "basis"],
    newClaims: [
      { ref: "counts", title: "Fixture comparable customer counts", claim: "Paying customers grew from 100 to 140 to 200 over three consecutive months.", url,
        excerpt: "Paying customers grew from 100 to 140 to 200 across three consecutive months.", type: "supports", relevanceReason: "Monthly net additions increased from 40 to 60.", publishedAt: new Date().toISOString() },
      { ref: "basis", title: "Fixture measurement basis", claim: "All three customer counts exclude free accounts.", url,
        excerpt: "Free accounts are excluded in all three months.", type: "neutral", relevanceReason: "The measurements use a comparable basis.", publishedAt: new Date().toISOString() },
    ],
  } };
  await runAssess(db, next, next.hypotheses[0]!, undefined, async () => finalResult,
    async () => new Map([[url, { status: "retrieved", url, text: updatedText, retrievedAt: new Date().toISOString() }]]));
  console.log(`Created synthetic rehearsal at ${path}. Start with ASOF_DB_PATH set to this path, then open /c/fixture/h/adoption.`);
} finally {
  db.close();
}
