import { test, expect } from "bun:test";
import { compareThesis, nudge, statusFromConfidence, thesisAsOf } from "../src/domain/thesis";
import type { Company, Evidence } from "../src/domain/types";

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
  hypotheses: [
    {
      id: "moat",
      statement: "Competitive moat is strengthening",
      confidence: 58,
      status: "at-risk",
      history: [
        { asOf: "2026-01-12", confidence: 78, reasoning: "", evidenceIds: [] },
        { asOf: "2026-03-01T15:00:00Z", confidence: 81, reasoning: "", evidenceIds: [] },
        { asOf: "2026-09-20", confidence: 58, reasoning: "", evidenceIds: ["series-b"] },
      ],
      evidence: [ev("seed-stage", "2026-02-10"), ev("series-b", "2026-06-04"), ev("undated", undefined, "2026-09-20")],
    },
    {
      id: "retention",
      statement: "Enterprise retention is strong",
      confidence: 70,
      status: "supported",
      history: [{ asOf: "2026-06-01", confidence: 70, reasoning: "", evidenceIds: [] }],
      evidence: [],
    },
  ],
};

test("status thresholds match the README examples", () => {
  expect([82, 71, 67, 58, 40].map(statusFromConfidence)).toEqual([
    "supported",
    "supported",
    "mixed",
    "at-risk",
    "contradicted",
  ]);
});

test("nudge moves per item, ignores neutral, and clamps", () => {
  expect(nudge(60, [{ type: "supports" }, { type: "supports" }, { type: "neutral" }])).toBe(70);
  expect(nudge(60, [{ type: "contradicts" }])).toBe(55);
  expect(nudge(93, [{ type: "supports" }])).toBe(95);
  expect(nudge(7, [{ type: "contradicts" }])).toBe(5);
});

test("thesisAsOf rewinds confidence and evidence to the given day", () => {
  const march = thesisAsOf(acme, "2026-03-01");
  expect(march.hypotheses).toHaveLength(1); // retention had no version yet
  const moat = march.hypotheses[0]!;
  expect(moat.confidence).toBe(81); // same-day version counts, despite its time of day
  expect(moat.status).toBe("supported");
  expect(moat.evidence.map((e) => e.id)).toEqual(["seed-stage"]);
});

test("undated evidence is known from when we discovered it", () => {
  const moat = thesisAsOf(acme, "2026-09-24").hypotheses[0]!;
  expect(moat.evidence.map((e) => e.id)).toEqual(["seed-stage", "series-b", "undated"]);
});

test("compareThesis reports confidence moves and evidence added since", () => {
  const changes = compareThesis(thesisAsOf(acme, "2026-03-01"), thesisAsOf(acme, "2026-09-24"));
  expect(changes[0]).toMatchObject({
    id: "moat",
    before: { confidence: 81, status: "supported" },
    after: { confidence: 58, status: "at-risk" },
  });
  expect(changes[0]!.newEvidence.map((e) => e.id)).toEqual(["series-b", "undated"]);
  expect(changes[1]).toMatchObject({ id: "retention", before: undefined });
});
