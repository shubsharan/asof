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

CREATE TABLE IF NOT EXISTS hypotheses (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  lens       TEXT NOT NULL, -- shared across companies, e.g. "moat"; lines the matrix up
  statement  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hypothesis_versions (
  id            INTEGER PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
  as_of         TEXT NOT NULL,
  confidence    INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  status        TEXT NOT NULL CHECK (status IN ('supported', 'mixed', 'at-risk', 'contradicted')),
  reasoning     TEXT NOT NULL,
  evidence_ids  TEXT NOT NULL CHECK (json_array_length(evidence_ids) > 0), -- JSON array of evidence.id
  open_questions TEXT NOT NULL DEFAULT '[]' -- JSON array of strings
);
CREATE INDEX IF NOT EXISTS hypothesis_versions_by_date ON hypothesis_versions (hypothesis_id, as_of);

CREATE TABLE IF NOT EXISTS evidence (
  id            TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
  title         TEXT NOT NULL,
  claim         TEXT NOT NULL,
  url           TEXT NOT NULL,
  published_at  TEXT,
  discovered_at TEXT NOT NULL,
  type          TEXT CHECK (type IN ('supports', 'contradicts', 'neutral')), -- NULL: not yet classified
  source        TEXT NOT NULL CHECK (source IN ('search', 'agent', 'monitor')),
  source_reasoning TEXT,
  UNIQUE (hypothesis_id, url)
);

-- One execution of an Exa research kind against a hypothesis (search, agent) or a company (monitor).
CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('search', 'agent', 'monitor')),
  company_id    TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id TEXT REFERENCES hypotheses(id), -- NULL for monitor runs
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
  kind          TEXT NOT NULL CHECK (kind IN ('search', 'agent', 'monitor')),
  company_id    TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id TEXT REFERENCES hypotheses(id),
  every_hours   INTEGER NOT NULL CHECK (every_hours > 0),
  enabled       INTEGER NOT NULL DEFAULT 1,
  next_run_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
`;

export function createDb(path = DB_PATH): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA busy_timeout = 5000"); // backfill runs several writers at once
  migrate(db);
  db.run(SCHEMA);
  return db;
}

/**
 * Upgrades databases created before `hypotheses.lens` existed (the frozen demo data among them).
 * Seeded ids are `${companyId}-${lens}`, so the lens is recovered from the id.
 */
export function migrate(db: Database): void {
  const hasHypotheses = db.query<{ n: number }, []>("SELECT count(*) AS n FROM sqlite_master WHERE name = 'hypotheses'").get()!.n;
  if (!hasHypotheses) return;
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(hypotheses)").all().map((c) => c.name);
  if (columns.includes("lens")) return;
  db.run("ALTER TABLE hypotheses ADD COLUMN lens TEXT");
  db.run(
    `UPDATE hypotheses SET lens = CASE WHEN id LIKE company_id || '-%' THEN substr(id, length(company_id) + 2) ELSE id END
     WHERE lens IS NULL`,
  );
}
