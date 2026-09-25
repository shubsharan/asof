// Backfills a company's thesis history through the app: for each past date, Exa Search limited to
// pages published by then, then an Exa Agent assessment dated that day. Usage:
//   bun run backfill <companyId> [hypothesisId...] [--dates 2026-01-12,2026-03-01]
import { createDb } from "../db/schema";
import { getCompany } from "../db/queries";
import { loadHypothesis, runAgent, runSearch } from "../research";

const DEFAULT_DATES = ["2026-01-12", "2026-03-01", "2026-06-04"];

const args = process.argv.slice(2);
const datesFlag = args.indexOf("--dates");
const dates = datesFlag >= 0 ? args.splice(datesFlag, 2)[1]!.split(",") : DEFAULT_DATES;
const [companyId, ...only] = args;
if (!companyId) throw new Error("Usage: bun run backfill <companyId> [hypothesisId...] [--dates d1,d2]");

const db = createDb();
const company = getCompany(db, companyId);
if (!company) throw new Error(`Unknown company ${companyId}`);
const ids = only.length ? only : company.hypotheses.map((h) => h.id);

for (const id of ids) {
  for (const date of dates) {
    const before = loadHypothesis(db, companyId, id, date)!;
    const found = await runSearch(db, before.company, before.hypothesis, date);
    const t = loadHypothesis(db, companyId, id, date)!;
    const h = await runAgent(db, t.company, t.hypothesis, date);
    console.log(`${id} @ ${date}: +${found.length} search evidence → ${h.confidence}% ${h.status}`);
  }
}
