import type { Database } from "bun:sqlite";
import { thesisAsOf } from "../domain/thesis";
import type { Company, Direction, Evidence, Hypothesis, HypothesisVersion, PortfolioHypothesis } from "../domain/types";

/** Evidence as it arrives from a source, before AsOf assigns an id and timestamps. */
export type NewEvidence = Omit<Evidence, "id" | "companyId" | "hypothesisId" | "discoveredAt" | "source">;

type EvidenceRow = {
  id: string;
  company_id: string;
  hypothesis_id: string;
  title: string;
  claim: string;
  url: string;
  published_at: string | null;
  discovered_at: string;
  type: Evidence["type"] | null;
  source: Evidence["source"];
  source_reasoning: string | null;
};

type VersionRow = {
  hypothesis_id: string;
  as_of: string;
  verdict: Direction;
  confidence: number;
  reasoning: string;
  evidence_ids: string;
  open_questions: string;
};

const toEvidence = (r: EvidenceRow): Evidence => ({
  id: r.id,
  companyId: r.company_id,
  hypothesisId: r.hypothesis_id,
  title: r.title,
  claim: r.claim,
  url: r.url,
  publishedAt: r.published_at ?? undefined,
  discoveredAt: r.discovered_at,
  type: r.type ?? undefined,
  source: r.source,
  sourceReasoning: r.source_reasoning ?? undefined,
});

const toVersion = (r: VersionRow): HypothesisVersion => ({
  asOf: r.as_of,
  verdict: r.verdict,
  confidence: r.confidence,
  reasoning: r.reasoning,
  evidenceIds: JSON.parse(r.evidence_ids),
  openQuestions: JSON.parse(r.open_questions),
});

/** Adds a hypothesis to the portfolio. Every company is untested on it until assessed against evidence. */
export function createHypothesis(db: Database, h: PortfolioHypothesis): void {
  db.query("INSERT INTO hypotheses (id, name, statement) VALUES (?, ?, ?)").run(h.id, h.name, h.statement);
}

/** The portfolio's hypotheses, in the order they were added. */
export function listHypotheses(db: Database): PortfolioHypothesis[] {
  return db.query<PortfolioHypothesis, []>("SELECT id, name, statement FROM hypotheses ORDER BY rowid").all();
}

export function setMonitorId(db: Database, companyId: string, monitorId: string): void {
  db.query("UPDATE companies SET monitor_id = ? WHERE id = ?").run(monitorId, companyId);
}

/**
 * Stores new evidence for a company's hypothesis, skipping URLs already recorded for that pair.
 * Evidence never changes confidence by itself; that takes an assessment.
 * Returns the evidence that was actually added.
 */
export function recordEvidence(
  db: Database,
  companyId: string,
  hypothesisId: string,
  items: NewEvidence[],
  source: Evidence["source"],
  now = new Date().toISOString(),
): Evidence[] {
  const insert = db.query<EvidenceRow, Record<string, string | null>>(
    `INSERT INTO evidence (id, company_id, hypothesis_id, title, claim, url, published_at, discovered_at, type, source, source_reasoning)
     VALUES ($id, $companyId, $hypothesisId, $title, $claim, $url, $publishedAt, $now, $type, $source, $sourceReasoning)
     ON CONFLICT (company_id, hypothesis_id, url) DO NOTHING
     RETURNING *`,
  );
  return db.transaction(() =>
    items.flatMap((item) => {
      const row = insert.get({
        id: crypto.randomUUID(),
        companyId,
        hypothesisId,
        title: item.title,
        claim: item.claim,
        url: item.url,
        publishedAt: item.publishedAt ?? null,
        now,
        type: item.type ?? null,
        source,
        sourceReasoning: item.sourceReasoning ?? null,
      });
      return row ? [toEvidence(row)] : [];
    }),
  )();
}

/**
 * Appends an assessment of a company on a hypothesis. The assessor (the team, or Exa Agent)
 * decides the verdict and its confidence; it must cite evidence already recorded for the pair.
 */
export function assessHypothesis(
  db: Database,
  companyId: string,
  hypothesisId: string,
  assessment: Omit<HypothesisVersion, "asOf">,
  now = new Date().toISOString(),
): void {
  const { evidenceIds } = assessment;
  if (evidenceIds.length === 0) throw new Error("An assessment must cite evidence");
  const known = db
    .query<{ n: number }, [string, string, string]>(
      "SELECT count(*) AS n FROM evidence WHERE company_id = ? AND hypothesis_id = ? AND id IN (SELECT value FROM json_each(?))",
    )
    .get(companyId, hypothesisId, JSON.stringify(evidenceIds))!.n;
  if (known !== new Set(evidenceIds).size) {
    throw new Error(`Assessment cites evidence not recorded for ${companyId} on ${hypothesisId}`);
  }
  db.query(
    `INSERT INTO hypothesis_versions (company_id, hypothesis_id, as_of, verdict, confidence, reasoning, evidence_ids, open_questions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    companyId,
    hypothesisId,
    now,
    assessment.verdict,
    assessment.confidence,
    assessment.reasoning,
    JSON.stringify(evidenceIds),
    JSON.stringify(assessment.openQuestions),
  );
}

/** The company with full history and evidence, as it looked on `asOf` (default: now). */
export function getCompany(db: Database, id: string, asOf = new Date().toISOString()): Company | undefined {
  const row = db
    .query<{ id: string; name: string; description: string; domain: string; monitor_id: string | null }, [string]>(
      "SELECT id, name, description, domain, monitor_id FROM companies WHERE id = ?",
    )
    .get(id);
  if (!row) return undefined;
  const { monitor_id, ...company } = row;

  const versions = db
    .query<VersionRow, [string]>("SELECT * FROM hypothesis_versions WHERE company_id = ? ORDER BY as_of, id")
    .all(id);
  const evidence = db
    .query<EvidenceRow, [string]>("SELECT * FROM evidence WHERE company_id = ? ORDER BY coalesce(published_at, discovered_at)")
    .all(id);

  const full: Company = {
    ...company,
    monitorId: monitor_id ?? undefined,
    hypotheses: listHypotheses(db).map(
      (h): Hypothesis => ({
        ...h,
        verdict: "untested", // filled in from the latest version by thesisAsOf
        history: versions.filter((v) => v.hypothesis_id === h.id).map(toVersion),
        evidence: evidence.filter((e) => e.hypothesis_id === h.id).map(toEvidence),
      }),
    ),
  };
  return thesisAsOf(full, asOf);
}

/** Every company as it looked on `asOf`, via `getCompany`, so cross-company views share its as-of rules. */
export function listCompanies(db: Database, asOf?: string): Company[] {
  return db
    .query<{ id: string }, []>("SELECT id FROM companies ORDER BY rowid")
    .all()
    .map((c) => getCompany(db, c.id, asOf)!);
}
