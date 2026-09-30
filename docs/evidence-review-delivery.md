# Evidence review delivery

Implementation follows the four delivery phases in the supplied assessment ownership plan. Existing chart changes are preserved. Each phase receives a read-only Ponytail review before the next phase starts.

## Baseline and database protection

- Baseline: 54 tests passed; `bunx tsc --noEmit` passed.
- SQLite-consistent backup: `data/backups/asof-before-review-1790638891008.sqlite`, created with `VACUUM INTO`; integrity check passed.
- Backup contains 954 evidence records and 78 machine research assessments.
- Frozen demo SHA-256: `778c53e2e81d5fcd3a1a77e097f6db67dd8f1dae214adaca4519f9d1859949db`.
- Migration must pass against a copy before the working database is opened with the new schema.

## Phase verification

Verification results are recorded here as each phase completes. Live provider checks are recorded separately from deterministic local tests.

### Phase 1

- 60 tests passed; TypeScript and browser bundle checks passed.
- Both migration copies passed integrity, foreign key and repeated migration checks. Working copy preserved 954 evidence rows and 78 research assessments; frozen demo copy preserved 198 evidence rows and 16 research assessments. Neither acquired an official assessment.
- Browser verification on a disposable copy: initial unassessed state, proposal edit, keyboard save, first official assessment, and mobile layout at 390px with no horizontal overflow.
- Ponytail review found a dead assessment compatibility wrapper and duplicate draft projections. Both findings were accepted and removed. Tests and TypeScript passed after removal.
- The legacy official table retains its required confidence column internally for compatibility; official API responses omit model confidence.

### Phase 2

- 66 tests passed; TypeScript passed. Bun's CLI bundle succeeded with warnings for Tailwind directives; the app server's Tailwind plugin rendered the browser checks correctly.
- Browser verification on the disposable copy: imported evidence grouped in the inbox, relevant decision with note, evidence awaiting a conclusion, separate considered and cited controls, keyboard save of an unchanged verdict, and pending evidence removed after incorporation. Mobile at 390px had no horizontal overflow.
- Review revisions are timestamped. Tests cover irrelevant input exclusion, disputed notes, late-arriving evidence, historical decisions, and incorporation across successive assessments.
- Ponytail review: Lean already. Ship.

### Phase 3

- 78 tests passed; TypeScript passed. The Tailwind-enabled Bun build passed without the standalone CLI directive warnings.
- Source tests cover unchanged and changed pages, failed retrieval deduplication, exact captured-version citations, grouping, and concurrent run additions.
- v2 and v4 migration copies passed integrity and foreign-key checks, preserving all 954 original evidence IDs without fabricated captures. v5 removes the legacy confidence column from official storage.
- Browser checks on the disposable copy: retrieved excerpts, analyst source-relationship correction, grouping three reports into two developments, and the immutable stored-source dialog. Mobile at 390px had no horizontal overflow.
- Ponytail review identified duplicate Snapshot retrieval code. The accepted change reuses the Contents adapter while preserving separate historical and current outcomes.
- A further browser check saved an assessment citing page version one, then recorded version two at the same URL. Version two appeared awaiting review, while the saved citation still opened version one's stored text. Grouping was also undone successfully.

### Phase 4

- 90 tests passed (318 assertions); TypeScript and `git diff --check` passed. A Tailwind-enabled Bun build produced three artifacts without warnings.
- Tests cover persisted creation keys and payloads, retry after ambiguous creation, repeated stop failures, orphan and duplicate collection schedules, native remote inspection, collection failure, queued collection after stop, and prevention of legacy monitor resurrection.
- Ponytail review found a dead monitor setter and two runtime copies of the monitor ID. Both were removed; `company_watches` is the sole runtime authority. The old company column is migration input only.
- Browser checks cover keyboard watch startup and collection, native remote progress, local collection timestamps, pending evidence counts, and desktop/mobile layouts at 1440px and 390px.
- Screenshot review caught a narrow source-dialog clipping issue. The fix wraps hashes and actions and constrains grid children; the 390px browser check measured the dialog at 356px for both client and scroll width.
- Existing remote monitor IDs are adopted without remote calls. Migration schedules their first hourly local collection one hour later; it does not create a replacement monitor.
- Migration now wraps all upgrade phases and the version update in one transaction. A forced late failure test confirms that earlier schema and data changes roll back together. Final Ponytail closeout: Lean already. Ship.

## Bounded live provider checks

These checks used `/tmp/asof-live-1790642869623.sqlite`, a disposable database containing one company and one hypothesis. They did not alter the working research database.

- Search: two queries through the production adapter collected 15 reports; all 15 received full-text source captures.
- Snapshot: historical and current retrievals for the Anthropic news page both returned content, kept as separate outcomes (1,433 and 1,962 characters).
- Agent first attempt: completed with `schema_satisfied` at $0.5683, but cited a URL absent from both input evidence and its new-evidence records. The validation boundary rejected it and saved no proposal. The prompt now explicitly requires complete evidence for every new citation, and errors name unsupported URLs.
- Agent bounded retry: completed with `schema_satisfied` at $0.5192; created a pending proposal with 13 citations and 10 new evidence records. Official assessment count remained zero. Each attempt was capped at $1 and five minutes.
- Monitor: one temporary daily monitor, `agentmon_01m3nam38bn8514tva1qzsbebk`, was created through the company page. Its first refresh completed at `2026-09-29T00:58:23.745Z`. A subsequent local collection added two unreviewed reports; official assessments remained zero.
- Monitor cleanup: Stop watching deleted the remote monitor, cleared its runtime ID, and disabled its hourly collection schedule. A provider GET returned 404 at `2026-09-29T00:59:53.066Z`. Collected evidence was preserved. Both disposable app servers were stopped after verification.

## Working database rollout

- Final migration-copy checks passed for original v2 working data (954 evidence, 78 research assessments) and v0 frozen data (198 evidence, 16 research assessments), including repeated migration, exact content preservation, integrity, and foreign keys.
- The frozen demo still matches its original SHA-256.
- Working migration preflight paused when it found v4 and a separate hot-reload server on port 3000. The user authorized continuation.
- Stopped the existing server and created a fresh SQLite-consistent backup at `data/backups/asof-before-final-rollout-1790644678929.sqlite`. Migrated a copy of that exact v4 state before migrating the working database to v6 at `2026-09-29T01:17:58.972Z`.
- Verified every existing evidence field and all research assessments, reviews, proposals, and runs against the fresh backup. All 954 evidence records and 78 research assessments were preserved; official assessments and reviews remain zero. Integrity and foreign-key checks passed.
- Restarted the app with `bun --hot src/server.ts` on port 3000. The homepage and portfolio API both returned HTTP 200, with five companies and all 954 evidence records. The existing Exa monitor was adopted with one hourly collection schedule, first due at `2026-09-29T02:17:58.967Z`.
- Frozen demo SHA-256 remains unchanged after the working migration.
