# AsOf

AsOf is a small Exa-powered research applet. Follow a hypothesis through collected sources, passage-backed claims, an AI assessment, and an explanation of what changed.

## Using the app

- Research opens on company summaries. Select a question for the analysis and citations.
- Each question has a rubric stating what would support or challenge it and the comparison period. The default period is the preceding 12 months, with comparable earlier periods where available.
- Refresh research asks Exa Agent to investigate leads, weigh claims, and propose an assessment. AsOf saves the result after checking exact claim references and matching new supporting passages to captured source text. A passage match establishes attribution, not truth.
- Watch this company uses Exa Monitor to find new developments. Its updates are collected leads. Refresh remains explicit; new material does not automatically change a conclusion.
- The question page separates unresolved leads from claims awaiting assessment. Considered claims can remain uncited. Evidence arriving during a run remains pending, and a failed refresh keeps the previous assessment.
- Recorded history uses assessment recording time and evidence discovery time. Reconstructions use a research cutoff and show when they were generated. They are retrospective research, not proof of what was knowable at the cutoff.

Claim cards show the reported fact. Opening a claim shows its relevance to the hypothesis, exact saved passage, and source. Leads and legacy evidence remain labeled; a saved text preview is not presented as a supporting quotation. Compare with latest retrieves current text on request and highlights changed passages.

New assessments retain their predecessor, input and considered evidence IDs, decisive citations, provider provenance, and the hypothesis rubric used. Confidence describes confidence in the verdict, not the probability that the hypothesis is true. Inconclusive can mean conflicting evidence or insufficient evidence; the reasoning explains which.

Existing analyst decisions, proposals, source reviews, and historical citations remain stored for compatibility. They do not become new recorded AI assessments. Previously excluded sources remain excluded from generation. Migration labels existing evidence as legacy without inventing supporting passages. A legacy item can guide research but needs a newly extracted passage-backed claim before it can be cited in a new assessment.

## Application routes

| Route | View |
|---|---|
| `/` or `/portfolio` | Company research summaries |
| `/updates` | Sources recently found by Exa |
| `/c/:companyId` | Company questions and monitoring |
| `/c/:companyId/h/:hypothesisId` | AI assessment, sources, and earlier research |
| `/hypotheses/:hypothesisId` | One question across companies |
| `/settings` | Optional research schedules |

## Runtime

The application uses Bun, React, SQLite through `bun:sqlite`, the Exa SDK, and the existing component library. Bun serves the HTTP API and bundles the frontend from its HTML entry point. There is no separate frontend server.

| Setting | Purpose |
|---|---|
| `EXA_API_KEY` | Exa provider credentials, loaded from `.env` by Bun |
| `ASOF_DB_PATH` | SQLite path, default `data/asof.sqlite` |
| `PORT` | HTTP port, default `3000` |

Company monitoring uses a daily Exa Agent Monitor and hourly local collection. Exa can refresh remotely while AsOf is closed. AsOf imports those results only while its server is running. Collection adds sources; assessment jobs save AI research directly.

New monitors include the hypothesis rubrics. Existing remote monitors keep their creation-time configuration; restarting a watch creates a monitor with the current rubric.

## Local commands

```sh
bun install
bun run dev
```

The existing database is migrated on startup. Before opening an older working database with changed migration code, create a SQLite-consistent backup and verify migration on a copy. The frozen demo at `data/demo.sqlite` must remain unchanged.

The seed command replaces the selected database with company and hypothesis definitions. It is for a new or disposable database, not the working research database.

```sh
ASOF_DB_PATH=/tmp/asof-demo.sqlite bun run seed
ASOF_DB_PATH=/tmp/asof-demo.sqlite PORT=3100 bun run dev
```

Historical research can be generated with the backfill command. Its --reset option deletes reconstructed research for the selected hypotheses and preserves official assessments and evidence.

```sh
bun run backfill <companyId> [hypothesisId...] --dates YYYY-MM-DD,YYYY-MM-DD
```

The read API and browser share history selection. `/api/companies?history=recorded` is the default; `history=reconstruction` selects publication-cutoff research. `asOf` filters that mode's clock, and `assessmentId` selects an exact saved assessment, including repeated reconstructions for the same cutoff. The browser fetches `/api/companies?raw=1` once and applies the same selector locally.

## Provider-free rehearsal

Create a new disposable database with synthetic sources and two recorded assessments. The script refuses to overwrite an existing file and makes no provider calls.

```sh
bun run rehearse /tmp/asof-rehearsal.sqlite
ASOF_DB_PATH=/tmp/asof-rehearsal.sqlite PORT=3108 bun run dev
```

Open `/c/fixture/h/adoption`. Inspect the rubric, the two claims from one source page, their supporting passages, and the explanation of the move from inconclusive to supported. Earlier research opens the exact first assessment. The company and analysis explicitly identify this as a fixture rehearsal. Refreshing through the app still uses the configured provider; creating the fixture does not substitute a fake provider into normal operation.

## Verification

```sh
bun test
bunx tsc --noEmit
```

The app server loads Tailwind through `bunfig.toml`. A standalone bundle check also needs that plugin:

```sh
bun - <<'TS'
import tailwind from "bun-plugin-tailwind";
const result = await Bun.build({
  entrypoints: ["./src/index.html"],
  outdir: "/tmp/asof-build",
  plugins: [tailwind],
});
if (!result.success) throw new AggregateError(result.logs, "Build failed");
TS
```

Routine tests use deterministic provider fixtures. See [research handoff verification](docs/research-handoffs-delivery.md) for this implementation and [earlier delivery checks](docs/evidence-review-delivery.md) for prior provider runs. Live Search, Agent, Monitor, and Snapshot checks use a disposable database. Temporary remote monitors must be removed after those checks.

Authentication, collaboration, additional providers, and presentation preparation are outside this implementation.
