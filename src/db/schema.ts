import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Generated at runtime (by `bun run seed` and the app); gitignored. */
export const DB_PATH = "data/asof.sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  domain      TEXT NOT NULL,
  monitor_id  TEXT -- Exa Agent Monitor tracking this company, once created
);

-- Portfolio-level: every company is tracked on every hypothesis. A company with no versions on one is untested.
CREATE TABLE IF NOT EXISTS hypotheses (
  id        TEXT PRIMARY KEY, -- e.g. "moat"
  name      TEXT NOT NULL,    -- e.g. "Moat"
  statement TEXT NOT NULL
);

-- Supports / neutral / contradicts: the same words evidence is tagged with.
CREATE TABLE IF NOT EXISTS hypothesis_versions (
  id             INTEGER PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id  TEXT NOT NULL REFERENCES hypotheses(id),
  as_of          TEXT NOT NULL,
  verdict        TEXT NOT NULL CHECK (verdict IN ('supports', 'neutral', 'contradicts')),
  confidence     INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100), -- in the verdict
  reasoning      TEXT NOT NULL,
  evidence_ids   TEXT NOT NULL CHECK (json_array_length(evidence_ids) > 0), -- JSON array of evidence.id
  open_questions TEXT NOT NULL DEFAULT '[]' -- JSON array of strings
);
CREATE INDEX IF NOT EXISTS hypothesis_versions_by_date ON hypothesis_versions (company_id, hypothesis_id, as_of);

CREATE TABLE IF NOT EXISTS evidence (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id    TEXT NOT NULL REFERENCES hypotheses(id),
  title            TEXT NOT NULL,
  claim            TEXT NOT NULL,
  url              TEXT NOT NULL,
  published_at     TEXT,
  discovered_at    TEXT NOT NULL,
  type             TEXT CHECK (type IN ('supports', 'neutral', 'contradicts')), -- NULL: not yet classified
  source           TEXT NOT NULL CHECK (source IN ('search', 'agent', 'monitor')), -- the Exa tool that found it
  source_reasoning TEXT,
  UNIQUE (company_id, hypothesis_id, url)
);

-- One research job against a company's hypothesis (research, assess) or a whole company (watch).
CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  job           TEXT NOT NULL CHECK (job IN ('research', 'assess', 'watch')),
  company_id    TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id TEXT REFERENCES hypotheses(id), -- NULL for watch runs
  trigger       TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule')),
  schedule_id   TEXT, -- no FK: deleting a schedule keeps its run history
  status        TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  created_at    TEXT NOT NULL,
  started_at    TEXT,
  finished_at   TEXT,
  error         TEXT,
  result        TEXT -- JSON RunResult, once done
);
CREATE INDEX IF NOT EXISTS runs_by_date ON runs (created_at);

CREATE TABLE IF NOT EXISTS schedules (
  id            TEXT PRIMARY KEY,
  job           TEXT NOT NULL CHECK (job IN ('research', 'assess', 'watch')),
  company_id    TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id TEXT REFERENCES hypotheses(id),
  every_hours   INTEGER NOT NULL CHECK (every_hours > 0),
  enabled       INTEGER NOT NULL DEFAULT 1,
  next_run_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
`;

const VERSION = 2;

export function createDb(path = DB_PATH): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000"); // backfill runs several writers at once
  migrate(db);
  db.run("PRAGMA foreign_keys = ON");
  return db;
}

const hasTable = (db: Database, name: string) =>
  db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)!.n > 0;
const columnsOf = (db: Database, table: string) => db.query<{ name: string }, []>(`PRAGMA table_info(${table})`).all().map((c) => c.name);

/**
 * Brings any database up to the current schema, tracked by `PRAGMA user_version`. Databases from
 * before versioning (the frozen demo data among them) report 0 and are recognized by their columns.
 * Runs with foreign keys off, since v2 rebuilds tables that reference each other.
 */
export function migrate(db: Database): void {
  const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;
  if (version < VERSION && hasTable(db, "hypotheses") && columnsOf(db, "hypotheses").includes("company_id")) {
    db.run("PRAGMA foreign_keys = OFF");
    db.transaction(() => {
      addLens(db);
      portfolioHypotheses(db);
    })();
  }
  db.run(SCHEMA);
  db.run(`PRAGMA user_version = ${VERSION}`);
}

/**
 * v1: hypotheses gained `lens`, the key shared across companies. Seeded ids are `${companyId}-${lens}`,
 * so the lens is recovered from the id.
 */
function addLens(db: Database): void {
  if (columnsOf(db, "hypotheses").includes("lens")) return;
  db.run("ALTER TABLE hypotheses ADD COLUMN lens TEXT");
  db.run(
    `UPDATE hypotheses SET lens = CASE WHEN id LIKE company_id || '-%' THEN substr(id, length(company_id) + 2) ELSE id END
     WHERE lens IS NULL`,
  );
}

/**
 * v2: one hypothesis per lens for the whole portfolio, with versions and evidence keyed by
 * (company, hypothesis); verdicts in the evidence vocabulary; runs keyed by job, not Exa tool.
 * The old tables are renamed aside, the new ones created from SCHEMA, and rows copied across.
 * Old verdicts are mapped only to satisfy the new CHECK: their confidence meant "probability the
 * hypothesis is true", so they are meant to be reassessed (`bun run backfill <company> --reset`).
 */
function portfolioHypotheses(db: Database): void {
  const old = ["hypotheses", "hypothesis_versions", "evidence", "runs", "schedules"].filter((t) => hasTable(db, t));
  for (const t of old) db.run(`ALTER TABLE ${t} RENAME TO old_${t}`);
  db.run("DROP INDEX IF EXISTS hypothesis_versions_by_date");
  db.run("DROP INDEX IF EXISTS runs_by_date");
  db.run(SCHEMA);

  db.run(
    `INSERT INTO hypotheses (id, name, statement)
     SELECT lens, upper(substr(lens, 1, 1)) || replace(substr(lens, 2), '-', ' '), statement FROM old_hypotheses
     WHERE rowid IN (SELECT min(rowid) FROM old_hypotheses GROUP BY lens) ORDER BY rowid`,
  );
  db.run(
    `INSERT INTO hypothesis_versions (id, company_id, hypothesis_id, as_of, verdict, confidence, reasoning, evidence_ids, open_questions)
     SELECT v.id, h.company_id, h.lens, v.as_of,
            CASE v.status WHEN 'supported' THEN 'supports' WHEN 'mixed' THEN 'neutral' ELSE 'contradicts' END,
            v.confidence, v.reasoning, v.evidence_ids, v.open_questions
     FROM old_hypothesis_versions v JOIN old_hypotheses h ON h.id = v.hypothesis_id ORDER BY v.id`,
  );
  db.run(
    `INSERT INTO evidence (id, company_id, hypothesis_id, title, claim, url, published_at, discovered_at, type, source, source_reasoning)
     SELECT e.id, h.company_id, h.lens, e.title, e.claim, e.url, e.published_at, e.discovered_at, e.type, e.source, e.source_reasoning
     FROM old_evidence e JOIN old_hypotheses h ON h.id = e.hypothesis_id ORDER BY e.rowid`,
  );
  const job = "CASE kind WHEN 'search' THEN 'research' WHEN 'agent' THEN 'assess' ELSE 'watch' END";
  const lensOf = "(SELECT lens FROM old_hypotheses h WHERE h.id = hypothesis_id)";
  if (old.includes("runs")) {
    db.run(
      `INSERT INTO runs (id, job, company_id, hypothesis_id, trigger, schedule_id, status, created_at, started_at, finished_at, error, result)
       SELECT id, ${job}, company_id, ${lensOf}, trigger, schedule_id, status, created_at, started_at, finished_at, error,
              json_remove(result, '$.assessment') -- recorded in the old status vocabulary
       FROM old_runs ORDER BY rowid`,
    );
  }
  if (old.includes("schedules")) {
    db.run(
      `INSERT INTO schedules (id, job, company_id, hypothesis_id, every_hours, enabled, next_run_at, created_at)
       SELECT id, ${job}, company_id, ${lensOf}, every_hours, enabled, next_run_at, created_at FROM old_schedules ORDER BY rowid`,
    );
  }
  for (const t of old) db.run(`DROP TABLE old_${t}`);
}
