import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { getCompany } from "../db/queries";
import { migrate } from "../db/schema";
import { getRun, listSchedules } from "../db/runs";

/** A database as it looked before hypotheses were portfolio-wide: per-company rows, old statuses, runs by Exa tool. */
function oldDb({ lens = true } = {}) {
  const db = new Database(":memory:", { strict: true });
  db.run("CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, domain TEXT NOT NULL, monitor_id TEXT)");
  db.run(`CREATE TABLE hypotheses (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, statement TEXT NOT NULL${lens ? ", lens TEXT" : ""})`);
  db.run(`CREATE TABLE hypothesis_versions (id INTEGER PRIMARY KEY, hypothesis_id TEXT NOT NULL, as_of TEXT NOT NULL, confidence INTEGER NOT NULL,
          status TEXT NOT NULL, reasoning TEXT NOT NULL, evidence_ids TEXT NOT NULL, open_questions TEXT NOT NULL DEFAULT '[]')`);
  db.run("CREATE INDEX hypothesis_versions_by_date ON hypothesis_versions (hypothesis_id, as_of)");
  db.run(`CREATE TABLE evidence (id TEXT PRIMARY KEY, hypothesis_id TEXT NOT NULL, title TEXT NOT NULL, claim TEXT NOT NULL, url TEXT NOT NULL,
          published_at TEXT, discovered_at TEXT NOT NULL, type TEXT, source TEXT NOT NULL, source_reasoning TEXT, UNIQUE (hypothesis_id, url))`);
  db.run("INSERT INTO companies VALUES ('exa', 'Exa', '', 'exa.ai', 'mon_1'), ('brave', 'Brave', '', 'brave.com', NULL)");
  for (const c of ["exa", "brave"]) {
    db.run(`INSERT INTO hypotheses (id, company_id, statement) VALUES ('${c}-moat', '${c}', 'Moat is strengthening'), ('${c}-go-to-market', '${c}', 'GTM works')`);
  }
  if (lens) db.run("UPDATE hypotheses SET lens = substr(id, length(company_id) + 2)");
  db.run(`INSERT INTO evidence VALUES ('e1', 'exa-moat', 't', 'c', 'https://a', '2026-02-01', '2026-09-20', 'supports', 'search', NULL),
          ('e2', 'brave-moat', 't', 'c', 'https://a', NULL, '2026-09-20', NULL, 'monitor', NULL)`);
  db.run(`INSERT INTO hypothesis_versions (hypothesis_id, as_of, confidence, status, reasoning, evidence_ids) VALUES
          ('exa-moat', '2026-03-01', 74, 'supported', 'r', '["e1"]'), ('exa-moat', '2026-06-04', 36, 'at-risk', 'r', '["e1"]')`);
  return db;
}

function addRuns(db: Database) {
  db.run(`CREATE TABLE runs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, company_id TEXT NOT NULL, hypothesis_id TEXT, trigger TEXT NOT NULL,
          schedule_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT, result TEXT)`);
  db.run("CREATE INDEX runs_by_date ON runs (created_at)");
  db.run(`CREATE TABLE schedules (id TEXT PRIMARY KEY, kind TEXT NOT NULL, company_id TEXT NOT NULL, hypothesis_id TEXT, every_hours INTEGER NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1, next_run_at TEXT NOT NULL, created_at TEXT NOT NULL)`);
  db.run(`INSERT INTO runs (id, kind, company_id, hypothesis_id, trigger, status, created_at, result) VALUES
          ('r1', 'agent', 'exa', 'exa-moat', 'manual', 'done', '2026-09-01',
           '{"evidenceAdded":2,"assessment":{"before":{"status":"supported"},"after":{"status":"at-risk"}}}'),
          ('r2', 'monitor', 'exa', NULL, 'manual', 'done', '2026-09-02', '{"evidenceAdded":0}')`);
  db.run("INSERT INTO schedules VALUES ('s1', 'search', 'brave', 'brave-moat', 24, 1, '2026-10-01', '2026-09-01')");
}

test("v2 turns per-company hypotheses into portfolio hypotheses and keys data by company", () => {
  const db = oldDb();
  addRuns(db);
  migrate(db);

  expect(db.query("SELECT id, name, statement FROM hypotheses ORDER BY rowid").all()).toEqual([
    { id: "moat", name: "Moat", statement: "Moat is strengthening" },
    { id: "go-to-market", name: "Go to market", statement: "GTM works" },
  ]);
  const exa = getCompany(db, "exa")!.hypotheses.find((h) => h.id === "moat")!;
  expect(exa.history.map((v) => [v.verdict, v.confidence])).toEqual([["supports", 74], ["contradicts", 36]]);
  expect(exa.evidence.map((e) => [e.id, e.companyId])).toEqual([["e1", "exa"]]);
  expect(getCompany(db, "brave")!.hypotheses.map((h) => [h.id, h.verdict, h.evidence.length])).toEqual([
    ["moat", "untested", 1],
    ["go-to-market", "untested", 0],
  ]);

  expect(getRun(db, "r1")).toMatchObject({ job: "assess", hypothesisId: "moat", result: { evidenceAdded: 2 } });
  expect(getRun(db, "r1")!.result!.assessment).toBeUndefined(); // recorded in the old vocabulary
  expect(getRun(db, "r2")).toMatchObject({ job: "watch", hypothesisId: undefined });
  expect(listSchedules(db)).toMatchObject([{ id: "s1", job: "research", companyId: "brave", hypothesisId: "moat" }]);
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("a database from before lenses (the frozen demo) migrates too, gaining runs and schedules", () => {
  const db = oldDb({ lens: false });
  migrate(db);
  expect(db.query("SELECT id FROM hypotheses ORDER BY rowid").all()).toEqual([{ id: "moat" }, { id: "go-to-market" }]);
  expect(db.query("SELECT count(*) AS n FROM runs").get()).toEqual({ n: 0 });
  expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
});

test("migrating is idempotent", () => {
  const db = oldDb();
  migrate(db);
  migrate(db);
  expect(db.query("SELECT count(*) AS n FROM hypothesis_versions").get()).toEqual({ n: 2 });
});
