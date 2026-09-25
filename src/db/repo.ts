import type { Database } from "bun:sqlite";
import { thesisAsOf } from "../domain/thesis";
import type { Company, Evidence, Hypothesis, HypothesisStatus, HypothesisVersion } from "../domain/types";

/** Evidence as it arrives from a source, before AsOf assigns an id and timestamps. */
export type NewEvidence = Omit<Evidence, "id" | "hypothesisId" | "discoveredAt" | "source">;

type EvidenceRow = {
  id: string;
  hypothesis_id: string;
  title: string;
  claim: string;
  url: string;
  published_at: string | null;
  discovered_at: string;
  type: Evidence["type"];
  source: Evidence["source"];
};

type VersionRow = {
  hypothesis_id: string;
  as_of: string;
  confidence: number;
  status: HypothesisStatus;
  reasoning: string;
  evidence_ids: string;
};

const toEvidence = (r: EvidenceRow): Evidence => ({
  id: r.id,
  hypothesisId: r.hypothesis_id,
  title: r.title,
  claim: r.claim,
  url: r.url,
  publishedAt: r.published_at ?? undefined,
  discoveredAt: r.discovered_at,
  type: r.type,
  source: r.source,
});

const toVersion = (r: VersionRow): HypothesisVersion => ({
  asOf: r.as_of,
  confidence: r.confidence,
  status: r.status,
  reasoning: r.reasoning,
  evidenceIds: JSON.parse(r.evidence_ids),
});

/** Creates an untested hypothesis. It has no confidence until it is assessed against evidence. */
export function createHypothesis(db: Database, h: { id: string; companyId: string; statement: string }): void {
  db.query("INSERT INTO hypotheses (id, company_id, statement) VALUES (?, ?, ?)").run(h.id, h.companyId, h.statement);
}

/**
 * Stores new evidence for a hypothesis, skipping URLs already recorded for it.
 * Evidence never changes confidence by itself; that takes an assessment.
 * Returns the evidence that was actually added.
 */
export function recordEvidence(
  db: Database,
  hypothesisId: string,
  items: NewEvidence[],
  source: Evidence["source"],
  now = new Date().toISOString(),
): Evidence[] {
  const insert = db.query<EvidenceRow, Record<string, string | null>>(
    `INSERT INTO evidence (id, hypothesis_id, title, claim, url, published_at, discovered_at, type, source)
     VALUES ($id, $hypothesisId, $title, $claim, $url, $publishedAt, $now, $type, $source)
     ON CONFLICT (hypothesis_id, url) DO NOTHING
     RETURNING *`,
  );
  return db.transaction(() =>
    items.flatMap((item) => {
      const row = insert.get({
        id: crypto.randomUUID(),
        hypothesisId,
        title: item.title,
        claim: item.claim,
        url: item.url,
        publishedAt: item.publishedAt ?? null,
        now,
        type: item.type,
        source,
      });
      return row ? [toEvidence(row)] : [];
    }),
  )();
}

/**
 * Appends an assessment to a hypothesis's history. The assessor (the team, or Exa Agent)
 * decides confidence and status; it must cite evidence already recorded for this hypothesis.
 */
export function assessHypothesis(
  db: Database,
  hypothesisId: string,
  assessment: Omit<HypothesisVersion, "asOf">,
  now = new Date().toISOString(),
): void {
  const { evidenceIds } = assessment;
  if (evidenceIds.length === 0) throw new Error("An assessment must cite evidence");
  const known = db
    .query<{ n: number }, [string, string]>(
      "SELECT count(*) AS n FROM evidence WHERE hypothesis_id = ? AND id IN (SELECT value FROM json_each(?))",
    )
    .get(hypothesisId, JSON.stringify(evidenceIds))!.n;
  if (known !== new Set(evidenceIds).size) {
    throw new Error(`Assessment cites evidence not recorded for hypothesis ${hypothesisId}`);
  }
  db.query(
    `INSERT INTO hypothesis_versions (hypothesis_id, as_of, confidence, status, reasoning, evidence_ids)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(hypothesisId, now, assessment.confidence, assessment.status, assessment.reasoning, JSON.stringify(evidenceIds));
}

/** The company with full history and evidence, as it looked on `asOf` (default: now). */
export function getCompany(db: Database, id: string, asOf = new Date().toISOString()): Company | undefined {
  const company = db
    .query<{ id: string; name: string; description: string }, [string]>(
      "SELECT id, name, description FROM companies WHERE id = ?",
    )
    .get(id);
  if (!company) return undefined;

  const hypotheses = db
    .query<{ id: string; statement: string }, [string]>(
      "SELECT id, statement FROM hypotheses WHERE company_id = ? ORDER BY rowid",
    )
    .all(id);
  const versions = db
    .query<VersionRow, [string]>(
      `SELECT v.* FROM hypothesis_versions v JOIN hypotheses h ON h.id = v.hypothesis_id
       WHERE h.company_id = ? ORDER BY v.as_of, v.id`,
    )
    .all(id);
  const evidence = db
    .query<EvidenceRow, [string]>(
      `SELECT e.* FROM evidence e JOIN hypotheses h ON h.id = e.hypothesis_id
       WHERE h.company_id = ? ORDER BY coalesce(e.published_at, e.discovered_at)`,
    )
    .all(id);

  const full: Company = {
    ...company,
    hypotheses: hypotheses.map(
      (h): Hypothesis => ({
        ...h,
        status: "untested", // filled in from the latest version by thesisAsOf
        history: versions.filter((v) => v.hypothesis_id === h.id).map(toVersion),
        evidence: evidence.filter((e) => e.hypothesis_id === h.id).map(toEvidence),
      }),
    ),
  };
  return thesisAsOf(full, asOf);
}

export type PortfolioEntry = {
  id: string;
  name: string;
  hypothesisCount: number;
  /** Assessments made in the 7 days before `now`. */
  changesThisWeek: number;
};

export function listPortfolio(db: Database, now = new Date().toISOString()): PortfolioEntry[] {
  const weekAgo = new Date(Date.parse(now) - 7 * 24 * 60 * 60 * 1000).toISOString();
  return db
    .query<PortfolioEntry, { weekAgo: string; now: string }>(
      `SELECT c.id, c.name,
         (SELECT count(*) FROM hypotheses h WHERE h.company_id = c.id) AS hypothesisCount,
         (SELECT count(*) FROM hypothesis_versions v JOIN hypotheses h ON h.id = v.hypothesis_id
          WHERE h.company_id = c.id AND v.as_of > $weekAgo AND v.as_of <= $now) AS changesThisWeek
       FROM companies c ORDER BY c.rowid`,
    )
    .all({ weekAgo, now });
}
