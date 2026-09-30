import { expect, test } from "bun:test";
import { createDb, migrate } from "../db/schema";
import { createHypothesis, getCompany, getCompanyData, listCompaniesData, recordClaimBatch, recordEvidence, recordResearchAssessment } from "../db/queries";
import type { NewClaim, SourceCaptureInput } from "../db/queries";

function setup() {
  const db = createDb(":memory:");
  db.run("INSERT INTO companies (id, name, description, domain) VALUES ('acme', 'Acme', '', 'acme.test'), ('beta', 'Beta', '', 'beta.test')");
  createHypothesis(db, { id: "moat", name: "Moat", statement: "Moat is strengthening" });
  return db;
}

const url = "https://example.com/report";
const passage = "Retention rose to 90% while churn fell to 2%.";
const capture = (text: string): Map<string, SourceCaptureInput> => new Map([[url, {
  status: "retrieved", url, text, retrievedAt: "2026-09-30T10:00:00Z",
}]]);
const claim = (text: string): NewClaim => ({
  title: "Annual report", claim: text, url, excerpt: passage, type: "supports", relevanceReason: "Tests retention",
  grounding: { passage: 1 },
});

test("a saved page keeps multiple distinct passage claims and reuses its first complete batch", () => {
  const db = setup();
  const captures = capture(`Opening. ${passage} Closing.`);
  const first = recordClaimBatch(db, "acme", "moat", [claim("Retention rose"), claim("Churn fell")], "agent", undefined, captures);
  expect(first.added).toHaveLength(2);
  expect(first.claims.map((item) => item.kind)).toEqual(["claim", "claim"]);
  expect(first.claims[0]!.sourceVersionId).toBe(first.claims[1]!.sourceVersionId);
  expect(first.claims[0]!.grounding).toEqual({ passage: 1 });
  const reused = recordClaimBatch(db, "acme", "moat", [claim("Reworded by model")], "agent", undefined, captures);
  expect(reused.added).toEqual([]);
  expect(reused.claims.map((item) => item.id)).toEqual(first.claims.map((item) => item.id));
  expect(db.query("SELECT count(*) AS n FROM source_versions").get()).toEqual({ n: 1 });

  const changed = recordClaimBatch(db, "acme", "moat", [claim("New report wording")], "agent", undefined,
    capture(`Changed page. ${passage}`));
  expect(changed.added).toHaveLength(1);
  expect(changed.claims[0]!.sourceVersionId).not.toBe(first.claims[0]!.sourceVersionId);
});

test("claim batches reject missing or duplicated passages without partial evidence", () => {
  const db = setup();
  const captures = capture(`Opening. ${passage}`);
  expect(() => recordClaimBatch(db, "acme", "moat", [claim("Good"), { ...claim("Bad"), excerpt: "Absent passage" }], "agent", undefined, captures))
    .toThrow(/absent/);
  expect(db.query("SELECT count(*) AS n FROM evidence").get()).toEqual({ n: 0 });
  expect(db.query("SELECT count(*) AS n FROM source_versions").get()).toEqual({ n: 0 });
  expect(() => recordClaimBatch(db, "acme", "moat", [claim("Same"), claim("Same")], "agent", undefined, captures))
    .toThrow(/Duplicate/);
  expect(db.query("SELECT count(*) AS n FROM evidence").get()).toEqual({ n: 0 });
  expect(() => recordClaimBatch(db, "acme", "moat", [claim("No capture")], "agent")).toThrow(/captured full source text/);
});

test("v7 migration preserves v6 evidence IDs, source versions, and research", () => {
  const db = setup();
  const old = recordEvidence(db, "acme", "moat", [{ title: "Old report", claim: "Old observation", url }],
    "search", "2026-09-29T10:00:00Z", capture(`Opening. ${passage}`))[0]!;
  const prior = recordResearchAssessment(db, "acme", "moat", { verdict: "neutral", confidence: 50,
    reasoning: "Old reasoning", evidenceIds: [old.id], openQuestions: [], origin: "legacy" });
  db.run("ALTER TABLE hypotheses DROP COLUMN rubric");
  for (const column of ["kind", "relevance_reason", "grounding"]) db.run(`ALTER TABLE evidence DROP COLUMN ${column}`);
  for (const column of ["previous_assessment_id", "input_evidence_ids", "considered_evidence_ids", "provider_run_id",
    "raw_output", "grounding", "hypothesis_snapshot", "change_reason", "decisive_evidence_ids"]) {
    db.run(`ALTER TABLE research_assessments DROP COLUMN ${column}`);
  }
  db.run("PRAGMA user_version = 6");
  migrate(db);
  const hypothesis = getCompanyData(db, "acme")!.hypotheses[0]!;
  expect(hypothesis.evidence[0]).toMatchObject({ id: old.id, kind: "legacy", sourceVersionId: old.sourceVersionId });
  expect(hypothesis.researchHistory?.[0]).toMatchObject({ id: prior.id, reasoning: "Old reasoning" });
  expect(hypothesis.rubric?.supportingSignals.length).toBeGreaterThan(0);
  expect(db.query("PRAGMA user_version").get()).toEqual({ user_version: 7 });
  migrate(db);
  expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
});

test("research lineage persists while citations require target-matched saved passages", () => {
  const db = setup();
  const [saved] = recordClaimBatch(db, "acme", "moat", [claim("Retention rose")], "agent", undefined,
    capture(`Opening. ${passage}`)).claims;
  const rubric = getCompanyData(db, "acme")!.hypotheses[0]!.rubric;
  const base = {
    verdict: "supports" as const, confidence: 75, reasoning: "Retention improved", evidenceIds: [saved!.id],
    openQuestions: [], origin: "agent" as const, recordedAt: "2026-09-30T11:00:00Z",
    inputEvidenceIds: [saved!.id], consideredEvidenceIds: [saved!.id], decisiveEvidenceIds: [saved!.id],
    providerRunId: "run-1", rawOutput: { verdict: "supports" }, grounding: { field: "reasoning" },
    hypothesisSnapshot: { statement: "Moat is strengthening", rubric }, changeReason: "First research",
  };
  const first = recordResearchAssessment(db, "acme", "moat", base);
  const next = recordResearchAssessment(db, "acme", "moat", { ...base, previousAssessmentId: first.id,
    providerRunId: "run-2", changeReason: "Same signal persists", recordedAt: "2026-09-30T12:00:00Z" });
  expect(next).toMatchObject({ previousAssessmentId: first.id, providerRunId: "run-2", rawOutput: base.rawOutput,
    inputEvidenceIds: [saved!.id], decisiveEvidenceIds: [saved!.id], hypothesisSnapshot: base.hypothesisSnapshot });
  expect(getCompany(db, "acme", "2026-09-29")!.hypotheses[0]!.evidence).toEqual([]);
  expect(getCompanyData(db, "acme")!.hypotheses[0]!.researchHistory).toHaveLength(2);
  expect(listCompaniesData(db)).toHaveLength(2);
  expect(() => recordResearchAssessment(db, "beta", "moat", { ...base, previousAssessmentId: first.id })).toThrow(/target|not recorded/);
  const beta = recordClaimBatch(db, "beta", "moat", [claim("Beta retention")], "agent", undefined,
    capture(`Opening. ${passage}`)).claims[0]!;
  expect(() => recordResearchAssessment(db, "beta", "moat", { ...base, evidenceIds: [beta.id],
    inputEvidenceIds: [beta.id], consideredEvidenceIds: [beta.id], decisiveEvidenceIds: [beta.id],
    previousAssessmentId: first.id })).toThrow(/Previous research assessment/);
  const lead = recordEvidence(db, "acme", "moat", [{ title: "Lead", claim: "Unverified", url: "https://example.com/lead" }], "search")[0]!;
  expect(() => recordResearchAssessment(db, "acme", "moat", { ...base, previousAssessmentId: next.id, evidenceIds: [lead.id],
    inputEvidenceIds: [lead.id], consideredEvidenceIds: [lead.id], decisiveEvidenceIds: [lead.id] }))
    .toThrow(/saved source passages/);
  expect(() => recordResearchAssessment(db, "acme", "moat", { ...base, previousAssessmentId: next.id, consideredEvidenceIds: [] })).toThrow(/considered/);
  expect(() => recordResearchAssessment(db, "acme", "moat", { ...base, previousAssessmentId: next.id, decisiveEvidenceIds: ["missing"] })).toThrow(/cited/);
});
