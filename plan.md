# AsOf Plan

## 1. Thesis machinery
- [x] Types in `src/domain/types.ts` (Company, Hypothesis, HypothesisVersion, Evidence)
- [x] SQLite schema in `src/db/schema.ts` — hypothesis history is append-only; "current" = latest version
- [x] Thesis logic in `src/domain/thesis.ts`: status from confidence, evidence nudge, `thesisAsOf(date)`, compare two dates
- [ ] Repo functions: `recordEvidence`, `getCompany(asOf?)`, `listPortfolio`
- [ ] Seed Acme (4 hypotheses, history on Jan 12 / Mar 1 / Jun 4 / today, ~10 evidence items) + Northstar, Vector
- [ ] `server.ts` replaces `index.ts`; routes: portfolio, company, hypothesis, compare (all accept `?asOf=`)
- [ ] Scripts: `dev`, `seed`, `test`; tests pass

## 2. Exa Search
- [ ] `bun add exa-js`, `EXA_API_KEY` in `.env`
- [ ] `POST /api/research/search` → Exa results → Evidence → `recordEvidence`
- [ ] Optional: set Evidence `type` (supports / contradicts / neutral) with Jev `choice()` (see 4a)

## 3. Exa Agent
- [ ] `POST /api/research/agent` → structured `HypothesisUpdate` (+ `openQuestions` on versions) → `applyThesisUpdate`

## 4. Exa Monitor
- [ ] One monitor per hypothesis (`POST /api/monitor/create`)
- [ ] `GET /api/monitor/events`; new items flow through `recordEvidence`

## 4a. Jev triage (TypeSafe AI)
Fast, cheap typed decisions between Exa calls. No prose — Agent still writes `reasoning` / `openQuestions`.
- [ ] `bun add @typesafe-ai/sdk`, `TYPESAFE_API_KEY` in `.env`
- [ ] `src/research/triage.ts`: one `systemOne` call per Monitor item →
  - `choice()` which hypothesis it affects (→ `hypothesisId`)
  - `choice()` supports / contradicts / neutral (→ Evidence `type`)
  - `score()` relevance; `noul()` is it noise → drop below threshold
  - `noul()` warrants deeper diligence → flag for Agent (3)
- [ ] Optional: `score()` nudge size in `thesis.ts` instead of fixed constants
- [ ] Fallback when no key: route everything to the monitor's own hypothesis, `type: "neutral"`

## 5. Exa Snapshot
- [ ] `POST /api/snapshot` → search limited to what was available by a date
- [ ] Compare "then vs today" using `thesisAsOf` + compare

## 6. UI
- [ ] `index.html` + `src/main.tsx` (React via Bun HTML imports)
- [ ] Portfolio → Target overview → Hypothesis detail → Rewind timeline

## Notes
- Verify the current `exa-js` API before each Exa step.
- Verify the current `@typesafe-ai/sdk` API before 4a (untested so far).
- Present Jev as supporting infrastructure; the demo story stays the four Exa products.
- Seed what's fragile; run Search, Agent, Snapshot live.
