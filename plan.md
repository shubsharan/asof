# AsOf Plan

## 1. Thesis machinery
- [ ] Types in `src/domain/types.ts` (Company, Hypothesis, HypothesisVersion, Evidence, HypothesisUpdate)
- [ ] SQLite schema in `src/db/schema.ts` — hypothesis history is append-only; "current" = latest version
- [ ] Thesis logic in `src/domain/thesis.ts`: status from confidence, evidence nudge, `thesisAsOf(date)`, compare two dates
- [ ] Repo functions: `recordEvidence`, `applyThesisUpdate`, `getCompany(asOf?)`, `listPortfolio`
- [ ] Seed Acme (4 hypotheses, history on Jan 12 / Mar 1 / Jun 4 / today, ~10 evidence items) + Northstar, Vector
- [ ] `server.ts` replaces `index.ts`; routes: portfolio, company, hypothesis, compare (all accept `?asOf=`)
- [ ] Scripts: `dev`, `seed`, `test`; tests pass

## 2. Exa Search
- [ ] `bun add exa-js`, `EXA_API_KEY` in `.env`
- [ ] `POST /api/research/search` → Exa results → Evidence → `recordEvidence`

## 3. Exa Agent
- [ ] `POST /api/research/agent` → structured `HypothesisUpdate` → `applyThesisUpdate`

## 4. Exa Monitor
- [ ] One monitor per hypothesis (`POST /api/monitor/create`)
- [ ] `GET /api/monitor/events`; new items flow through `recordEvidence`

## 5. Exa Snapshot
- [ ] `POST /api/snapshot` → search limited to what was available by a date
- [ ] Compare "then vs today" using `thesisAsOf` + compare

## 6. UI
- [ ] `index.html` + `src/main.tsx` (React via Bun HTML imports)
- [ ] Portfolio → Target overview → Hypothesis detail → Rewind timeline

## Notes
- Verify the current `exa-js` API before each Exa step.
- Seed what's fragile; run Search, Agent, Snapshot live.
