// Backfills a company's thesis history through the app: for each past date, a Research job limited to
// pages published by then, then an Assess job dated that day. --reset first deletes the company's
// assessments on those hypotheses (evidence is kept). Usage:
//   bun run backfill <companyId> [hypothesisId...] [--dates 2026-01-12,2026-03-01] [--reset]
import { createDb } from "../db/schema";
import { getCompany } from "../db/queries";
import { loadHypothesis, runAssess, runResearch } from "../research";

const DEFAULT_DATES = ["2026-01-12", "2026-03-01", "2026-06-04"];

const args = process.argv.slice(2);
const reset = args.includes("--reset");
if (reset) args.splice(args.indexOf("--reset"), 1);
const datesFlag = args.indexOf("--dates");
const dates = datesFlag >= 0 ? args.splice(datesFlag, 2)[1]!.split(",") : DEFAULT_DATES;
const [companyId, ...only] = args;
if (!companyId) throw new Error("Usage: bun run backfill <companyId> [hypothesisId...] [--dates d1,d2] [--reset]");

const db = createDb();
const company = getCompany(db, companyId);
if (!company) throw new Error(`Unknown company ${companyId}`);
const ids = only.length ? only : company.hypotheses.map((h) => h.id);
if (reset) {
  const deleted = db
    .query("DELETE FROM hypothesis_versions WHERE company_id = ? AND hypothesis_id IN (SELECT value FROM json_each(?))")
    .run(companyId, JSON.stringify(ids)).changes;
  console.log(`Reset: deleted ${deleted} assessments for ${companyId}.`);
}

for (const id of ids) {
  for (const date of dates) {
    const before = loadHypothesis(db, companyId, id, date)!;
    const found = await runResearch(db, before.company, before.hypothesis, date);
    const t = loadHypothesis(db, companyId, id, date)!;
    const h = await runAssess(db, t.company, t.hypothesis, date);
    console.log(`${id} @ ${date}: +${found.length} evidence → ${h.verdict} (${h.confidence}% confident)`);
  }
}
