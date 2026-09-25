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
- [x] `bun add exa-js`, `EXA_API_KEY` in `.env`
- [x] `POST /api/research/search` → Exa results → Evidence → `recordEvidence`
- [x] Deep search (for + against queries) with `outputSchema` + `systemPrompt` source screening; `sourceReasoning` stored on Evidence
- [ ] Optional: set Evidence `type` (supports / contradicts / neutral) with Jev `choice()` (see 4a)

## 3. Exa Agent
- [x] `POST /api/research/agent` → evidence + assessment → `recordEvidence` + `assessHypothesis` (+ `openQuestions` on versions)
- [ ] Work out the confidence model with the team + agent (how evidence should move confidence)

## 3a. Backfill history through the app
- [x] Script: for Jan 12 / Mar 1 / Jun 4 / today, search with evidence limited to what was published by that date → `recordEvidence`, then assess dated that day → `assessHypothesis` (reasoning marked as reconstructed)
- [x] Freeze the result: copy `data/asof.sqlite` to `data/demo.sqlite` (done); copy it back before the demo

## 4. Exa Monitor
- [x] One Exa Agent Monitor (beta) per company, one field per hypothesis, daily (`POST /api/companies/:id/monitor`). Standard Monitors need a public HTTPS webhook, so not used
- [x] Monitor pull: change feed → `recordEvidence` unclassified (`type` absent; direction via Jev triage, 4a, or the next assessment). The events feed is evidence with `source: "monitor"`. Now a `monitor` research run (manual or scheduled, see 7), which also creates the monitor on first run; no longer pulled on page visit

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
- [x] `POST /api/snapshot {url, asOf}` → a page as it was on that date (Exa Snapshot) and as it is now. Snapshot isn't used in search: it doesn't work with deep search and drops publish dates; dated search uses `endPublishedDate`. ~5-month window, 100 trial requests
- [x] Compare "then vs today" in the UI: fetch the company at both dates, diff with `compareThesis`

## 6. UI
- [x] `src/index.html` + `src/main.tsx` (React via Bun HTML imports) + Tailwind v4 (`bun-plugin-tailwind` in `bunfig.toml`) + shadcn (`components.json`, add components with `bunx --bun shadcn@latest add <name>`)
- [x] Portfolio → Target overview → Hypothesis detail → Rewind timeline (`/`, `/c/:id`, `/c/:id/h/:hid`, `?asOf=`) — superseded by 7

## 7. Navigation & research runs (superseded by 8)
- [x] Runs (`runs` table): search / agent / monitor against a target, `manual` or `schedule` trigger, queued → running → done/failed with a result. In-process runner (`src/runner.ts`, concurrency 2, de-duplicates by target); `POST /api/runs` returns immediately
- [x] Schedules (`schedules` table) + in-process scheduler (`src/scheduler.ts`, ticks every minute; an overdue schedule fires once)
- [x] Updates feed (`src/domain/updates.ts`): assessments with before/after, evidence batched per hypothesis per day it became knowable, failed runs
- [x] ~~Feature-first sidebar (Updates · Companies · Hypotheses · Evidence · Research), company record tabs, as-of picker + banner~~ — replaced by 8

## 8. One time axis, one cursor, three zoom levels (lenses and matrix superseded by 9)
The visual thesis: every assessment is a point on a confidence-over-time step chart (`ConfidenceStrip`), evidence sits on the same axis where it became knowable, and the as-of date is one vertical cursor; everything right of it is dimmed because it wasn't known yet.
- [x] Hypotheses carry a `lens` (shared across companies, e.g. `moat`); `migrate()` in `src/db/schema.ts` upgrades older databases from the `${companyId}-${lens}` ids
- [x] `src/domain/timeline.ts`: shared time domain, day scale, assessment days, lenses, step segments, evidence ticks (all UTC days, like `thesisAsOf`)
- [x] `GET /api/companies` serves the whole portfolio once; the client rewinds it with `thesisAsOf` (`src/components/portfolio.tsx`), so scrubbing never hits the network
- [x] `TimeScrubber` in the sticky header: snap points on assessment days, drag / click / ← →; the date is committed to `?asOf=` on release (`src/components/asof.ts`). Its track shares `main`'s width, so the cursor lines up with the strips
- [x] Sidebar (`AppSidebar.tsx`): Portfolio (companies below it), Hypotheses (lenses below it), Updates, Settings; Research opens from its footer
- [x] Views on one primitive: `/` portfolio matrix (companies × lenses, `Matrix.tsx`), `/hypotheses[/:lens]` a lens across companies (`Hypotheses.tsx`), `/c/:id` a company across lenses (`Company.tsx`), `/c/:id/h/:hid` one cell (`HypothesisDetail.tsx`: the assessment at the cursor, cited evidence, Snapshot when rewound). Rows share `StripRow.tsx`
- [x] `/updates`: the changes feed up to the cursor, filterable by company (`Updates.tsx`)
- [x] `/settings`: research schedules. Research (run now + run history) is a panel (`ResearchSheet.tsx`), opened from the sidebar or `openResearch(target)`
- [ ] Column sort in the matrix, once more than one company has history
- [ ] Backfill Perplexity, Brave, Parallel and Tavily so the matrix compares across companies (`bun run backfill <companyId>`, spends Exa credits)

## 9. Data model cleanup
- [x] Hypotheses are portfolio-level (`hypotheses(id, name, statement)`); versions and evidence are keyed by `(company_id, hypothesis_id)`. No more lenses: `/hypotheses/:id` and `/c/:id/h/:hypothesisId` use the same id (`moat`)
- [x] One vocabulary: evidence `type` and assessment `verdict` are both `supports | neutral | contradicts`; `confidence` is confidence in the verdict (agent prompt in `src/exa/agent.ts`)
- [x] Runs and schedules by job: `research` (Exa Search), `assess` (Exa Agent), `watch` (Exa Monitor); `evidence.source` still records the tool
- [x] Versioned migrations (`PRAGMA user_version`) in `src/db/schema.ts`; v2 rebuilds older databases, the frozen demo included. Legacy monitor fields (`exa-moat`) map to the new ids
- [x] Portfolio is hypothesis cards (one row per company); Updates is an evidence table; the sidebar's Research panel is now Runs
- [ ] Re-assess history with the new prompt: `bun run backfill exa --reset` (16 Agent runs), then refreeze `data/demo.sqlite`
- [ ] `ConfidenceStrip` plots confidence-in-verdict; a flip from 70% supports to 70% contradicts draws flat. Consider a signed "lean" axis once real data is in

## Notes
- All code and tests live under `src/` (tests in `src/tests/`, generated data in `data/`); nothing but config at the repo root.
- Verify the current `exa-js` API before each Exa step.
- Verify the current `@typesafe-ai/sdk` API before 4a (untested so far).
- Present Jev as supporting infrastructure; the demo story stays the four Exa products.
- Never hand-write evidence: it comes from Exa through the app. For demo reliability, freeze a real run (3a) rather than seeding fakes.
