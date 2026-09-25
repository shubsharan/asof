import { test, expect } from "bun:test";
import { compareThesis, thesisAsOf } from "../domain/thesis";
import type { Company, Evidence } from "../domain/types";

const ev = (id: string, publishedAt: string | undefined, discoveredAt = "2026-09-20"): Evidence => ({
  id,
  companyId: "acme",
  hypothesisId: "moat",
  title: id,
  claim: id,
  url: `https://example.com/${id}`,
  publishedAt,
  discoveredAt,
  type: "contradicts",
  source: "search",
});

const acme: Company = {
  id: "acme",
  name: "Acme Security",
  description: "",
  domain: "acme.example",
  hypotheses: [
    {
      id: "moat",
      name: "Moat",
      statement: "Competitive moat is strengthening",
      verdict: "untested",
      history: [
        { asOf: "2026-03-01T15:00:00Z", verdict: "supports", confidence: 81, reasoning: "", evidenceIds: ["seed-stage"], openQuestions: [] },
        { asOf: "2026-09-20", verdict: "contradicts", confidence: 58, reasoning: "", evidenceIds: ["series-b"], openQuestions: [] },
      ],
      evidence: [ev("seed-stage", "2026-02-10"), ev("series-b", "2026-06-04"), ev("undated", undefined, "2026-09-20")],
    },
    {
      id: "retention",
      name: "Retention",
      statement: "Enterprise retention is strong",
      verdict: "untested",
      history: [{ asOf: "2026-06-01", verdict: "supports", confidence: 70, reasoning: "", evidenceIds: ["x"], openQuestions: [] }],
      evidence: [],
    },
  ],
};

test("thesisAsOf rewinds assessments and evidence to the given day", () => {
  const [moat, retention] = thesisAsOf(acme, "2026-03-01").hypotheses;
  expect(moat).toMatchObject({ verdict: "supports", confidence: 81 }); // same-day assessment counts
  expect(moat!.evidence.map((e) => e.id)).toEqual(["seed-stage"]);
  expect(retention).toMatchObject({ confidence: undefined, verdict: "untested" }); // not assessed yet
});

test("undated evidence is known from when we discovered it", () => {
  const moat = thesisAsOf(acme, "2026-09-24").hypotheses[0]!;
  expect(moat.evidence.map((e) => e.id)).toEqual(["seed-stage", "series-b", "undated"]);
});

test("compareThesis reports assessment moves and evidence added since", () => {
  const [moat, retention] = compareThesis(thesisAsOf(acme, "2026-03-01"), thesisAsOf(acme, "2026-09-24"));
  expect(moat).toMatchObject({
    before: { verdict: "supports", confidence: 81 },
    after: { verdict: "contradicts", confidence: 58 },
  });
  expect(moat!.newEvidence.map((e) => e.id)).toEqual(["series-b", "undated"]);
  expect(retention).toMatchObject({ before: { verdict: "untested" }, after: { verdict: "supports" } });
});
