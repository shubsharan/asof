import { test, expect } from "bun:test";
import { companyRows, hypothesisRows } from "../components/sliceRows";
import type { Company, HypothesisVersion } from "../domain/types";

const version = (asOf: string): HypothesisVersion => ({ asOf, verdict: "supports", confidence: 50, reasoning: "", evidenceIds: ["x"], openQuestions: [] });

const company = (id: string, hypotheses: Company["hypotheses"]): Company => ({ id, name: id.toUpperCase(), description: "", domain: "", hypotheses });
const hyp = (id: string, history: HypothesisVersion[]): Company["hypotheses"][number] => ({ id, name: id[0]!.toUpperCase() + id.slice(1), statement: `${id} statement`, verdict: "untested", history, evidence: [] });

const acme = company("acme", [hyp("moat", [version("2026-03-01")]), hyp("adoption", [])]);
const beta = company("beta", [hyp("moat", []), hyp("adoption", [version("2026-01-12")])]);

test("companyRows gives one row per company assessed on the hypothesis, in portfolio order, linked", () => {
  const rows = companyRows([acme, beta], "moat");
  expect(rows.map((r) => r.id)).toEqual(["acme"]);
  expect(rows[0]).toMatchObject({ label: "ACME", href: "/c/acme/h/moat" });
  expect(rows[0]!.history).toHaveLength(1);
  expect(companyRows([acme, beta], "adoption").map((r) => r.id)).toEqual(["beta"]);
  expect(companyRows([acme, beta], "missing")).toEqual([]);
});

test("hypothesisRows gives one row per assessed hypothesis with its short name, linked", () => {
  const rows = hypothesisRows(acme);
  expect(rows.map((r) => r.id)).toEqual(["moat"]);
  expect(rows[0]).toMatchObject({ label: "Moat", href: "/c/acme/h/moat" });
  expect(hypothesisRows(company("empty", []))).toEqual([]);
});
