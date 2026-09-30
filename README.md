# AsOf

AsOf is a small Exa-powered research applet. Pick a company and a question to see Exa's assessment, the sources behind it, and how the research has changed over time.

## Using the app

- Research opens on company summaries. Select a question for the analysis and citations.
- Refresh research asks Exa Agent to investigate and saves its answer directly as AI research. There is no source approval or analyst assessment workflow.
- Watch this company uses Exa Monitor to find new developments. Updates shows the sources it finds; refresh a question to assess their implications.
- Earlier research and Research over time show previous assessments. Historical reconstructions use a publication cutoff and are labeled as such.

Source cards show the reported fact, publisher, date when available, and a link. Opening a source shows its saved excerpt immediately. Compare with latest retrieves current text on request and highlights changed passages; full text, provenance, and an optional historical date stay under details.

All assessments shown in the main experience are AI research. Existing analyst decisions and source reviews remain stored for compatibility, but are not approval gates. Previously excluded sources remain excluded from generation. Old pending proposals can be read as AI research without accepting them. Source versions and historical records are preserved; no migration or recapture of imported sources is needed.

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

Routine tests use deterministic provider fixtures. Live Search, Agent, Monitor, and Snapshot checks use a disposable database and are recorded separately in [the delivery record](docs/evidence-review-delivery.md). Temporary remote monitors must be removed after those checks.

Authentication, collaboration, additional providers, and presentation preparation are outside this implementation.
