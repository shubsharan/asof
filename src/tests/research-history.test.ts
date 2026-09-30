import { expect, test } from "bun:test";
import { pendingResearch, researchHistory, researchView } from "../domain/research";
import { rubricForHypothesis, rubricText } from "../domain/rubric";
import { buildSlices } from "../domain/slices";
import type { Company, Evidence, Hypothesis, ResearchAssessment } from "../domain/types";

const source = (id: string, patch: Partial<Evidence> = {}): Evidence => ({ id, companyId: "acme", hypothesisId: "adoption", title: id, claim: id,
  url: `https://example.com/${id}`, publishedAt: "2026-01-01", discoveredAt: "2026-09-01T09:00:00Z", source: "search",
  relationship: "unknown", relationshipAutomated: true, kind: "claim", ...patch });
const assessment = (id: number, patch: Partial<ResearchAssessment> = {}): ResearchAssessment => ({ id, origin: "agent", asOf: "2026-09-01T10:00:00Z",
  recordedAt: "2026-09-01T10:00:00Z", verdict: "neutral", confidence: 50, reasoning: "Not enough comparable measurements.", evidenceIds: ["a"], openQuestions: [], ...patch });
const hypothesis = (patch: Partial<Hypothesis> = {}): Hypothesis => ({ id: "adoption", name: "Adoption", statement: "Adoption is accelerating", verdict: "untested",
  evidence: [source("a")], history: [], researchHistory: [], reportCount: 1, developmentCount: 1, ...patch });
const company = (h: Hypothesis): Company => ({ id: "acme", name: "Acme", description: "", domain: "example.com", hypotheses: [h] });

test("recorded and reconstructed history select different clocks and preserve exact IDs", () => {
  const h = hypothesis({ researchHistory: [assessment(1), assessment(2, { origin: "reconstruction", targetDate: "2026-01-15", recordedAt: "2026-09-02T10:00:00Z" }),
    assessment(3, { origin: "reconstruction", targetDate: "2026-01-15", recordedAt: "2026-09-03T10:00:00Z", verdict: "supports" })] });
  expect(researchHistory(h).map((a) => a.id)).toEqual([1]);
  expect(researchView(company(h), "2026-01-15").hypotheses[0]).toMatchObject({ verdict: "untested", evidence: [], history: [] });
  expect(researchView(company(h), "2026-01-15", "reconstruction").hypotheses[0]!.history.at(-1)?.id).toBe(3);
  const earlier = researchView(company(h), undefined, "reconstruction", 2).hypotheses[0]!;
  expect(earlier.history.at(-1)?.id).toBe(2);
  expect(earlier.evidence.map((e) => e.id)).toEqual(["a"]);
});

test("an exact recorded assessment excludes evidence collected afterward without needing an asOf parameter", () => {
  const h = hypothesis({ evidence: [source("a"), source("later", { discoveredAt: "2026-09-01T11:00:00Z" })], researchHistory: [assessment(1)] });
  expect(researchView(company(h), undefined, "recorded", 1).hypotheses[0]!.evidence.map((e) => e.id)).toEqual(["a"]);
});

test("unknown legacy recording times never become recorded assessments or reconstruction substitutes", () => {
  const h = hypothesis({ researchHistory: [assessment(1, { origin: "legacy", recordedAt: undefined, originalAsOf: "2026-01-01" })] });
  expect(researchHistory(h)).toEqual([]);
  expect(researchHistory(h, "reconstruction")).toEqual([]);
  expect(researchView(company(h)).hypotheses[0]!.researchHistory).toHaveLength(1);
});

test("pending separates uncited considered claims, mid-run arrivals and unresolved leads", () => {
  const h = hypothesis({ evidence: [source("a"), source("b"), source("during"), source("lead", { kind: "lead" }),
    source("resolved", { kind: "lead", url: "https://example.com/a", sourceVersionId: "failed-capture",
      sourceVersion: { id: "failed-capture", url: "https://example.com/a", status: "unavailable", retrievedAt: "2026-09-01", error: "timeout" } })],
    researchHistory: [assessment(1, { consideredEvidenceIds: ["a", "b"], evidenceIds: ["a"] }),
      assessment(2, { origin: "reconstruction", targetDate: "2026-01-15", recordedAt: "2026-10-01T00:00:00Z", consideredEvidenceIds: ["during"] })] });
  expect(pendingResearch(h).claims.map((e) => e.id)).toEqual(["during"]);
  expect(pendingResearch(h).leads.map((e) => e.id)).toEqual(["lead"]);
});

test("reconstruction chart uses publication time and recorded chart uses collection time", () => {
  const row = { id: "adoption", label: "Adoption", history: [assessment(1)], evidence: [source("a"), source("undated", { publishedAt: undefined })] };
  expect(buildSlices([row], ["2026-01-15"])[0]!.cells[0]!.evidence.unclassified.shown).toEqual([]);
  const reconstructed = buildSlices([{ ...row, mode: "reconstruction" }], ["2026-01-15"])[0]!.cells[0]!;
  expect(reconstructed.evidence.unclassified.shown.map((e) => e.id)).toEqual(["a"]);
  expect(buildSlices([row], ["2026-09-01"])[0]!.cells[0]!.evidence.unclassified.shown).toHaveLength(2);
});

test("adoption rubric distinguishes acceleration from an announcement and is isolated from mutation", () => {
  const rubric = rubricForHypothesis("adoption")!;
  expect(rubricText({ id: "adoption", name: "Adoption", statement: "Adoption is accelerating", rubric })).toContain("does not establish acceleration");
  rubric.supportingSignals.length = 0;
  expect(rubricForHypothesis("adoption")!.supportingSignals.length).toBeGreaterThan(0);
});

test("backfill rejects invalid dates before opening a database", async () => {
  const path = `/tmp/asof-invalid-backfill-${crypto.randomUUID()}.sqlite`;
  for (const dates of ["2026-02-30", "not-a-date", ""]) {
    const result = Bun.spawnSync([process.execPath, "src/scripts/backfill.ts", "fixture", "--dates", dates], {
      env: { ...process.env, ASOF_DB_PATH: path },
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("valid YYYY-MM-DD");
  }
  expect(await Bun.file(path).exists()).toBe(false);
});
