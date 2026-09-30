import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { rubricForHypothesis } from "../domain/rubric";

/** Generated at runtime (by `bun run seed` and the app); gitignored. */
export const DB_PATH = process.env.ASOF_DB_PATH ?? "data/asof.sqlite";

const EVIDENCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS evidence (
  id                     TEXT PRIMARY KEY,
  company_id             TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id          TEXT NOT NULL REFERENCES hypotheses(id),
  title                  TEXT NOT NULL,
  claim                  TEXT NOT NULL,
  kind                   TEXT NOT NULL DEFAULT 'lead' CHECK (kind IN ('lead', 'claim', 'legacy')),
  url                    TEXT NOT NULL,
  published_at           TEXT,
  discovered_at          TEXT NOT NULL,
  type                   TEXT CHECK (type IN ('supports', 'neutral', 'contradicts')),
  source                 TEXT NOT NULL CHECK (source IN ('search', 'agent', 'monitor')),
  source_reasoning       TEXT,
  relevance_reason       TEXT,
  grounding              TEXT,
  imported               INTEGER NOT NULL DEFAULT 0,
  source_version_id      TEXT REFERENCES source_versions(id),
  excerpt                TEXT,
  verification_gap       TEXT,
  relationship           TEXT NOT NULL DEFAULT 'unknown' CHECK (relationship IN ('company', 'investor', 'customer-partner', 'independent', 'unknown')),
  relationship_automated INTEGER NOT NULL DEFAULT 1,
  group_id               TEXT REFERENCES evidence_groups(id),
  observation_hash       TEXT NOT NULL,
  UNIQUE (company_id, hypothesis_id, observation_hash)
);

CREATE TABLE IF NOT EXISTS evidence_reviews (
  id          INTEGER PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  decision    TEXT NOT NULL CHECK (decision IN ('relevant', 'irrelevant', 'disputed')),
  note        TEXT,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_reviews_by_evidence ON evidence_reviews (evidence_id, reviewed_at, id);
`;

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
  statement TEXT NOT NULL,
  rubric    TEXT
);

-- Supports / neutral / contradicts: the same words evidence is tagged with.
CREATE TABLE IF NOT EXISTS hypothesis_versions (
  id             INTEGER PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id  TEXT NOT NULL REFERENCES hypotheses(id),
  as_of          TEXT NOT NULL,
  verdict        TEXT NOT NULL CHECK (verdict IN ('supports', 'neutral', 'contradicts')),
  confidence     INTEGER NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100), -- legacy compatibility; official rows use 0
  reasoning      TEXT NOT NULL,
  evidence_ids   TEXT NOT NULL CHECK (json_array_length(evidence_ids) > 0), -- JSON array of evidence.id
  open_questions TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  reviewed_evidence_ids TEXT NOT NULL DEFAULT '[]',
  reviewed_evidence_review_ids TEXT NOT NULL DEFAULT '[]',
  proposal_id    TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS hypothesis_versions_by_date ON hypothesis_versions (company_id, hypothesis_id, as_of);

CREATE TABLE IF NOT EXISTS research_assessments (
  id             INTEGER PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id  TEXT NOT NULL REFERENCES hypotheses(id),
  target_date    TEXT,
  recorded_at    TEXT,
  original_as_of TEXT,
  verdict        TEXT NOT NULL CHECK (verdict IN ('supports', 'neutral', 'contradicts')),
  confidence     INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reasoning      TEXT NOT NULL,
  evidence_ids   TEXT NOT NULL,
  open_questions TEXT NOT NULL DEFAULT '[]',
  origin         TEXT NOT NULL CHECK (origin IN ('legacy', 'reconstruction', 'agent')),
  previous_assessment_id INTEGER REFERENCES research_assessments(id),
  input_evidence_ids TEXT,
  considered_evidence_ids TEXT,
  provider_run_id TEXT,
  raw_output TEXT,
  grounding TEXT,
  hypothesis_snapshot TEXT,
  change_reason TEXT,
  decisive_evidence_ids TEXT
);
CREATE INDEX IF NOT EXISTS research_assessments_by_target ON research_assessments (company_id, hypothesis_id, target_date);

CREATE TABLE IF NOT EXISTS assessment_proposals (
  id                     TEXT PRIMARY KEY,
  company_id             TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id          TEXT NOT NULL REFERENCES hypotheses(id),
  status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  verdict                TEXT NOT NULL CHECK (verdict IN ('supports', 'neutral', 'contradicts')),
  confidence             INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  reasoning              TEXT NOT NULL,
  open_questions         TEXT NOT NULL DEFAULT '[]',
  evidence_ids           TEXT NOT NULL,
  input_evidence_ids     TEXT NOT NULL,
  starting_assessment_id INTEGER REFERENCES hypothesis_versions(id),
  provider_run_id        TEXT NOT NULL,
  raw_output             TEXT NOT NULL,
  grounding              TEXT,
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assessment_proposals_by_target ON assessment_proposals (company_id, hypothesis_id, created_at DESC);

CREATE TABLE IF NOT EXISTS source_versions (
  id           TEXT PRIMARY KEY,
  url          TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('retrieved', 'unavailable')),
  content_hash TEXT,
  text         TEXT,
  excerpt      TEXT,
  grounding    TEXT,
  error        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS source_versions_by_content ON source_versions (url, content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS evidence_groups (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id),
  hypothesis_id TEXT NOT NULL REFERENCES hypotheses(id),
  created_at    TEXT NOT NULL
);

${EVIDENCE_SCHEMA}

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

CREATE TABLE IF NOT EXISTS company_watches (
  company_id             TEXT PRIMARY KEY REFERENCES companies(id),
  status                 TEXT NOT NULL CHECK (status IN ('stopped', 'starting', 'watching', 'stop-failed')),
  monitor_id             TEXT,
  idempotency_key        TEXT NOT NULL,
  creation_payload       TEXT,
  collection_schedule_id TEXT,
  last_collected_at      TEXT,
  latest_failure_at      TEXT,
  latest_failure_message TEXT,
  updated_at             TEXT NOT NULL
);
`;

const VERSION = 7;

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
  if (version >= VERSION) return;
  const foreignKeys = db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()!.foreign_keys;
  db.run("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      if (hasTable(db, "hypotheses") && columnsOf(db, "hypotheses").includes("company_id")) {
      addLens(db);
      portfolioHypotheses(db);
      }
      db.run(SCHEMA);
      if (version < 3 && hasTable(db, "hypothesis_versions")) migrateAssessments(db);
      if (version < 4) migrateReviews(db);
      if (version < 5) migrateSources(db);
      if (version < 6) migrateWatches(db);
      if (version < 7) migrateResearchHandoff(db);
      db.run(`PRAGMA user_version = ${VERSION}`);
    })();
  } finally {
    db.run(`PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  }
}

function migrateResearchHandoff(db: Database): void {
  if (!columnsOf(db, "hypotheses").includes("rubric")) db.run("ALTER TABLE hypotheses ADD COLUMN rubric TEXT");
  for (const row of db.query<{ id: string }, []>("SELECT id FROM hypotheses WHERE rubric IS NULL").all()) {
    const rubric = rubricForHypothesis(row.id);
    if (rubric) db.query("UPDATE hypotheses SET rubric = ? WHERE id = ?").run(JSON.stringify(rubric), row.id);
  }
  if (!columnsOf(db, "evidence").includes("kind")) db.run("ALTER TABLE evidence ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy' CHECK (kind IN ('lead', 'claim', 'legacy'))");
  if (!columnsOf(db, "evidence").includes("relevance_reason")) db.run("ALTER TABLE evidence ADD COLUMN relevance_reason TEXT");
  if (!columnsOf(db, "evidence").includes("grounding")) db.run("ALTER TABLE evidence ADD COLUMN grounding TEXT");
  const researchColumns = [
    ["previous_assessment_id", "INTEGER REFERENCES research_assessments(id)"],
    ["input_evidence_ids", "TEXT"],
    ["considered_evidence_ids", "TEXT"],
    ["provider_run_id", "TEXT"],
    ["raw_output", "TEXT"],
    ["grounding", "TEXT"],
    ["hypothesis_snapshot", "TEXT"],
    ["change_reason", "TEXT"],
    ["decisive_evidence_ids", "TEXT"],
  ] as const;
  const existing = columnsOf(db, "research_assessments");
  for (const [name, type] of researchColumns) if (!existing.includes(name)) db.run(`ALTER TABLE research_assessments ADD COLUMN ${name} ${type}`);
}

/** Existing remote monitor IDs are adopted without any provider calls. */
function migrateWatches(db: Database): void {
  db.transaction(() => {
    db.run(`INSERT OR IGNORE INTO company_watches
      (company_id, status, monitor_id, idempotency_key, creation_payload, updated_at)
      SELECT id, CASE WHEN monitor_id IS NULL THEN 'stopped' ELSE 'watching' END, monitor_id,
        lower(hex(randomblob(16))), NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM companies`);
    db.run(`INSERT INTO schedules (id, job, company_id, hypothesis_id, every_hours, enabled, next_run_at, created_at)
      SELECT lower(hex(randomblob(16))), 'watch', c.id, NULL, 1, 1,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM companies c WHERE c.monitor_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM schedules s WHERE s.company_id = c.id AND s.job = 'watch')`);
    db.run(`UPDATE company_watches SET collection_schedule_id = (
      SELECT id FROM schedules s WHERE s.company_id = company_watches.company_id AND s.job = 'watch' ORDER BY rowid LIMIT 1
    ) WHERE monitor_id IS NOT NULL`);
    db.run(`UPDATE schedules SET enabled = CASE WHEN rowid = (
      SELECT min(s2.rowid) FROM schedules s2 WHERE s2.company_id = schedules.company_id AND s2.job = 'watch'
    ) THEN 1 ELSE 0 END, every_hours = 1 WHERE job = 'watch'
      AND company_id IN (SELECT company_id FROM company_watches WHERE monitor_id IS NOT NULL)`);
    db.run(`UPDATE schedules SET enabled = 0 WHERE job = 'watch'
      AND company_id IN (SELECT company_id FROM company_watches WHERE monitor_id IS NULL)`);
  })();
}

/** Rebuild evidence to replace URL uniqueness with immutable source-version observations. */
function migrateSources(db: Database): void {
  db.transaction(() => {
    if (!columnsOf(db, "evidence").includes("source_version_id")) {
      db.run("DROP INDEX IF EXISTS evidence_reviews_by_evidence");
      db.run("ALTER TABLE evidence_reviews RENAME TO old_evidence_reviews");
      db.run("ALTER TABLE evidence RENAME TO old_evidence");
      db.run(EVIDENCE_SCHEMA);
      db.run(`INSERT INTO evidence
        (id, company_id, hypothesis_id, title, claim, url, published_at, discovered_at, type, source, source_reasoning,
         imported, relationship, relationship_automated, observation_hash, kind)
        SELECT id, company_id, hypothesis_id, title, claim, url, published_at, discovered_at, type, source, source_reasoning,
         imported, 'unknown', 1, id, 'legacy' FROM old_evidence`);
      db.run(`INSERT INTO evidence_reviews (id, evidence_id, decision, note, reviewed_at)
        SELECT id, evidence_id, decision, note, reviewed_at FROM old_evidence_reviews`);
      db.run("DROP TABLE old_evidence_reviews");
      db.run("DROP TABLE old_evidence");
    }
    if (columnsOf(db, "hypothesis_versions").includes("confidence")) db.run("ALTER TABLE hypothesis_versions DROP COLUMN confidence");
  })();
}

/** Existing evidence is marked as imported; no review decisions are invented. */
function migrateReviews(db: Database): void {
  db.transaction(() => {
    if (!columnsOf(db, "evidence").includes("imported")) db.run("ALTER TABLE evidence ADD COLUMN imported INTEGER NOT NULL DEFAULT 0");
    db.run("UPDATE evidence SET imported = 1");
    if (!columnsOf(db, "hypothesis_versions").includes("reviewed_evidence_review_ids")) {
      db.run("ALTER TABLE hypothesis_versions ADD COLUMN reviewed_evidence_review_ids TEXT NOT NULL DEFAULT '[]'");
    }
    if (!columnsOf(db, "research_assessments").includes("original_as_of")) db.run("ALTER TABLE research_assessments ADD COLUMN original_as_of TEXT");
  })();
}

/** Legacy model-written versions become research history. Official analyst history starts empty. */
function migrateAssessments(db: Database): void {
  db.transaction(() => {
    if (hasTable(db, "runs")) db.run("UPDATE runs SET result = json_remove(result, '$.assessment') WHERE result IS NOT NULL AND json_valid(result)");
    if (db.query<{ n: number }, []>("SELECT count(*) AS n FROM hypothesis_versions").get()!.n) {
      db.run(`INSERT INTO research_assessments
        (id, company_id, hypothesis_id, target_date, recorded_at, original_as_of, verdict, confidence, reasoning, evidence_ids, open_questions, origin)
        SELECT id, company_id, hypothesis_id,
          CASE WHEN reasoning LIKE 'Reconstructed on %' THEN substr(as_of, 1, 10) END,
          CASE WHEN reasoning LIKE 'Reconstructed on ____-__-__%' THEN substr(reasoning, 18, 10) END,
          as_of,
          verdict, confidence, reasoning, evidence_ids, open_questions,
          CASE WHEN reasoning LIKE 'Reconstructed on %' THEN 'reconstruction' ELSE 'legacy' END
        FROM hypothesis_versions ORDER BY id`);
      db.run("DELETE FROM hypothesis_versions");
    }
    if (!columnsOf(db, "hypothesis_versions").includes("reviewed_evidence_ids")) {
      db.run("ALTER TABLE hypothesis_versions ADD COLUMN reviewed_evidence_ids TEXT NOT NULL DEFAULT '[]'");
      db.run("ALTER TABLE hypothesis_versions ADD COLUMN proposal_id TEXT");
    }
    db.run("CREATE UNIQUE INDEX IF NOT EXISTS hypothesis_versions_proposal ON hypothesis_versions (proposal_id) WHERE proposal_id IS NOT NULL");
  })();
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
    `INSERT INTO evidence (id, company_id, hypothesis_id, title, claim, url, published_at, discovered_at, type, source, source_reasoning, observation_hash, kind)
     SELECT e.id, h.company_id, h.lens, e.title, e.claim, e.url, e.published_at, e.discovered_at, e.type, e.source, e.source_reasoning, e.id, 'legacy'
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
