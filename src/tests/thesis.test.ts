import { test, expect } from "bun:test";
import { compareThesis, thesisAsOf } from "../domain/thesis";
import type { Company, Evidence } from "../domain/types";

const ev = (id: string, publishedAt: string | undefined, discoveredAt = "2026-09-20"): Evidence => ({
  id,
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
      lens: "moat",
      statement: "Competitive moat is strengthening",
      status: "untested",
      history: [
        { asOf: "2026-03-01T15:00:00Z", confidence: 81, status: "supported", reasoning: "", evidenceIds: ["seed-stage"], openQuestions: [] },
        { asOf: "2026-09-20", confidence: 58, status: "at-risk", reasoning: "", evidenceIds: ["series-b"], openQuestions: [] },
      ],
      evidence: [ev("seed-stage", "2026-02-10"), ev("series-b", "2026-06-04"), ev("undated", undefined, "2026-09-20")],
    },
    {
      id: "retention",
      lens: "retention",
      statement: "Enterprise retention is strong",
      status: "untested",
      history: [{ asOf: "2026-06-01", confidence: 70, status: "supported", reasoning: "", evidenceIds: ["x"], openQuestions: [] }],
      evidence: [],
    },
  ],
};

test("thesisAsOf rewinds assessments and evidence to the given day", () => {
  const [moat, retention] = thesisAsOf(acme, "2026-03-01").hypotheses;
  expect(moat).toMatchObject({ confidence: 81, status: "supported" }); // same-day assessment counts
  expect(moat!.evidence.map((e) => e.id)).toEqual(["seed-stage"]);
  expect(retention).toMatchObject({ confidence: undefined, status: "untested" }); // not assessed yet
});

test("undated evidence is known from when we discovered it", () => {
  const moat = thesisAsOf(acme, "2026-09-24").hypotheses[0]!;
  expect(moat.evidence.map((e) => e.id)).toEqual(["seed-stage", "series-b", "undated"]);
});

test("compareThesis reports assessment moves and evidence added since", () => {
  const [moat, retention] = compareThesis(thesisAsOf(acme, "2026-03-01"), thesisAsOf(acme, "2026-09-24"));
  expect(moat).toMatchObject({
    before: { confidence: 81, status: "supported" },
    after: { confidence: 58, status: "at-risk" },
  });
  expect(moat!.newEvidence.map((e) => e.id)).toEqual(["series-b", "undated"]);
  expect(retention).toMatchObject({ before: { status: "untested" }, after: { status: "supported" } });
});
