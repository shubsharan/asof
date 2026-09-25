import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Generated at runtime (by `bun run seed` and the app); gitignored. */
export const DB_PATH = "data/asof.sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hypotheses (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  statement  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hypothesis_versions (
  id            INTEGER PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
  as_of         TEXT NOT NULL,
  confidence    INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  status        TEXT NOT NULL CHECK (status IN ('supported', 'mixed', 'at-risk', 'contradicted')),
  reasoning     TEXT NOT NULL,
  evidence_ids  TEXT NOT NULL CHECK (json_array_length(evidence_ids) > 0) -- JSON array of evidence.id
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
  type          TEXT NOT NULL CHECK (type IN ('supports', 'contradicts', 'neutral')),
  source        TEXT NOT NULL CHECK (source IN ('search', 'agent', 'monitor')),
  source_reasoning TEXT,
  UNIQUE (hypothesis_id, url)
);
`;

export function createDb(path = DB_PATH): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run(SCHEMA);
  return db;
}
