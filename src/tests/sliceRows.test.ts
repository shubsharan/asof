import { test, expect } from "bun:test";
import { companyRows, hypothesisRows } from "../components/sliceRows";
import type { Company, HypothesisVersion, ResearchAssessment } from "../domain/types";

const version = (asOf: string): HypothesisVersion => ({ asOf, verdict: "supports", confidence: 50, reasoning: "", evidenceIds: ["x"], openQuestions: [] });
const research = (id: number, targetDate?: string): ResearchAssessment => ({
  id,
  asOf: targetDate ?? "2026-09-20",
  targetDate,
  verdict: "supports",
  confidence: 50,
  reasoning: "",
  evidenceIds: ["x"],
  openQuestions: [],
  origin: targetDate ? "reconstruction" : "legacy",
});

const company = (id: string, hypotheses: Company["hypotheses"]): Company => ({ id, name: id.toUpperCase(), description: "", domain: "", hypotheses });
const hyp = (id: string, history: HypothesisVersion[], researchHistory?: ResearchAssessment[]): Company["hypotheses"][number] => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  statement: `${id} statement`,
  verdict: "untested",
  reportCount: 0,
  developmentCount: 0,
  history,
  researchHistory,
  evidence: [],
});

const acme = company("acme", [hyp("moat", [version("2026-03-01")], [research(1, "2026-02-01")]), hyp("adoption", [])]);
const betaResearch = { ...research(2), recordedAt: "2026-09-20T10:00:00Z" };
const beta = company("beta", [hyp("moat", [], [research(3)]), hyp("adoption", [version("2026-01-12")], [betaResearch])]);

test("companyRows gives one row per company with model research, using the research cutoff", () => {
  const rows = companyRows([acme, beta], "moat", "reconstruction");
  expect(rows.map((r) => r.id)).toEqual(["acme"]);
  expect(rows[0]).toMatchObject({ label: "ACME", href: "/c/acme/h/moat?history=reconstruction" });
  expect(rows[0]!.history.map((item) => item.asOf)).toEqual(["2026-02-01"]);
  expect(companyRows([acme, beta], "adoption").map((r) => r.id)).toEqual(["beta"]);
  expect(companyRows([acme, beta], "missing")).toEqual([]);
  expect(companyRows([beta], "moat")).toEqual([]);
  expect(companyRows([acme], "moat")).toEqual([]);
});

test("hypothesisRows gives one row per hypothesis with model research", () => {
  const rows = hypothesisRows(acme, "reconstruction");
  expect(rows.map((r) => r.id)).toEqual(["moat"]);
  expect(rows[0]).toMatchObject({ label: "Moat", href: "/c/acme/h/moat?history=reconstruction" });
  expect(rows[0]!.history[0]).toMatchObject({ asOf: "2026-02-01", confidence: 50 });
  expect(hypothesisRows(company("empty", []))).toEqual([]);
});
