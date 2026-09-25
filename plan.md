# AsOf Plan

## 1. Thesis machinery
- [x] Types in `src/domain/types.ts` (Company, Hypothesis, HypothesisVersion, Evidence)
- [x] SQLite schema in `src/db/schema.ts` — hypothesis history is append-only; "current" = latest version
- [x] Thesis logic in `src/domain/thesis.ts`: `thesisAsOf(date)`, compare two dates (no built-in confidence model)
- [x] Queries in `src/db/queries.ts`: `createHypothesis` (starts untested), `recordEvidence` (attaches only), `assessHypothesis` (must cite evidence), `getCompany(asOf?)`, `listPortfolio`
- [x] Seed Exa + Perplexity, Brave, Parallel, Tavily, 4 untested hypotheses each (structure only — no evidence, no assessments)
- [x] `src/server.ts` replaces `index.ts`; routes: portfolio, company (`?asOf=`)
- [x] Scripts: `dev`, `seed`, `test`; tests pass

## 2. Exa Search
- [ ] `bun add exa-js`, `EXA_API_KEY` in `.env`
- [ ] `POST /api/research/search` → Exa results → Evidence → `recordEvidence`
- [ ] Optional: set Evidence `type` (supports / contradicts / neutral) with Jev `choice()` (see 4a)

## 3. Exa Agent
- [ ] `POST /api/research/agent` → evidence + assessment → `recordEvidence` + `assessHypothesis` (+ `openQuestions` on versions)
- [ ] Work out the confidence model with the team + agent (how evidence should move confidence)

## 3a. Backfill history through the app
- [ ] Script: for Jan 12 / Mar 1 / Jun 4 / today, search with evidence limited to what was published by that date → `recordEvidence`, then assess dated that day → `assessHypothesis` (reasoning marked as reconstructed)
- [ ] Freeze the result (copy `data/asof.sqlite` or export JSON) and load it before the demo

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
- [ ] Store Jev's `confidence` on Evidence (`triageConfidence`, optional column; absent for Search/Agent evidence)
- [ ] Use Jev's `confidence` on each triage decision: low confidence → keep as `neutral` and flag for Agent; also an input to the confidence model (3)
- [ ] Fallback when no key: route everything to the monitor's own hypothesis, `type: "neutral"`

## 5. Exa Snapshot
- [ ] `POST /api/snapshot` → search limited to what was available by a date
- [ ] Compare "then vs today" in the UI: fetch the company at both dates, diff with `compareThesis`

## 6. UI
- [ ] `src/index.html` + `src/main.tsx` (React via Bun HTML imports)
- [ ] Portfolio → Target overview → Hypothesis detail → Rewind timeline

## Notes
- All code lives under `src/` (tests in `tests/`, generated data in `data/`); nothing but config at the repo root.
- Verify the current `exa-js` API before each Exa step.
- Verify the current `@typesafe-ai/sdk` API before 4a (untested so far).
- Present Jev as supporting infrastructure; the demo story stays the four Exa products.
- Never hand-write evidence: it comes from Exa through the app. For demo reliability, freeze a real run (3a) rather than seeding fakes.
