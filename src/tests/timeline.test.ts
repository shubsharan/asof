import { test, expect } from "bun:test";
import { addDays, assessmentDays, binTicks, evidenceTicks, scale, stepSegments, timeDomain } from "../domain/timeline";
import type { Company, Evidence, HypothesisVersion } from "../domain/types";

const version = (asOf: string, confidence: number, verdict: HypothesisVersion["verdict"] = "supports"): HypothesisVersion => ({
  asOf,
  verdict,
  confidence,
  reasoning: "",
  evidenceIds: ["x"],
  openQuestions: [],
});

const ev = (id: string, publishedAt: string | undefined, discoveredAt = "2026-09-20"): Evidence => ({
  id,
  companyId: "acme",
  hypothesisId: "h",
  title: id,
  claim: id,
  url: `https://example.com/${id}`,
  publishedAt,
  discoveredAt,
  type: "supports",
  source: "search",
});

const company = (id: string, hypotheses: Company["hypotheses"]): Company => ({ id, name: id, description: "", domain: "", hypotheses });

const acme = company("acme", [
  { id: "moat", name: "Moat", statement: "Moat is strengthening", verdict: "untested", history: [version("2026-03-01T15:00:00Z", 81), version("2026-06-04", 58, "contradicts")], evidence: [ev("old", "2025-01-01"), ev("feb", "2026-02-10"), ev("undated", undefined)] },
  { id: "adoption", name: "Adoption", statement: "Adoption is accelerating", verdict: "untested", history: [], evidence: [] },
]);
const beta = company("beta", [
  { id: "adoption", name: "Adoption", statement: "Adoption is accelerating", verdict: "untested", history: [version("2026-01-12", 40, "neutral")], evidence: [] },
]);

test("timeDomain starts 45 days before the first assessment and ends today", () => {
  expect(timeDomain([acme, beta], "2026-09-25")).toEqual(["2025-11-28", "2026-09-25"]);
});

test("timeDomain stretches to data dated after today, and falls back to a year when nothing is assessed", () => {
  const late = company("late", [{ id: "x", name: "X", statement: "", verdict: "untested", history: [version("2026-10-02T01:00:00Z", 50)], evidence: [] }]);
  expect(timeDomain([late], "2026-09-25")).toEqual(["2026-08-18", "2026-10-02"]);
  expect(timeDomain([company("empty", [])], "2026-09-25")).toEqual(["2025-09-25", "2026-09-25"]);
});

test("scale maps days to pixels and back, clamping at both ends", () => {
  const s = scale(["2026-01-01", "2026-01-11"], 100);
  expect(s.x("2026-01-06T23:00:00Z")).toBe(50);
  expect(s.x("2025-12-01")).toBe(0);
  expect(s.x("2027-01-01")).toBe(100);
  expect(s.day(50)).toBe("2026-01-06");
  expect(s.day(-20)).toBe("2026-01-01");
  expect(s.day(500)).toBe("2026-01-11");
});

test("assessmentDays are distinct portfolio-wide days before today, oldest first", () => {
  expect(assessmentDays([acme, beta], "2026-09-25")).toEqual(["2026-01-12", "2026-03-01", "2026-06-04"]);
  expect(assessmentDays([acme, beta], "2026-03-01")).toEqual(["2026-01-12"]);
});

test("stepSegments hold each assessment until the next, and the last until the end of the domain", () => {
  expect(stepSegments(acme.hypotheses[0]!.history, ["2025-11-28", "2026-09-25"])).toEqual([
    { asOf: "2026-03-01T15:00:00Z", from: "2026-03-01", to: "2026-06-04", verdict: "supports", confidence: 81 },
    { asOf: "2026-06-04", from: "2026-06-04", to: "2026-09-25", verdict: "contradicts", confidence: 58 },
  ]);
  expect(stepSegments([], ["2025-11-28", "2026-09-25"])).toEqual([]);
});

test("evidenceTicks place evidence by knownAt and bucket anything before the domain", () => {
  const { ticks, earlier } = evidenceTicks(acme.hypotheses[0]!.evidence, ["2025-11-28", "2026-09-25"]);
  expect(ticks).toEqual([
    { id: "feb", at: "2026-02-10", type: "supports" },
    { id: "undated", at: "2026-09-20", type: "supports" },
  ]);
  expect(earlier.map((e) => e.id)).toEqual(["old"]);
});

test("addDays works in UTC days", () => {
  expect(addDays("2026-03-01T23:59:00Z", 1)).toBe("2026-03-02");
  expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
});

test("binTicks groups ticks into pixel buckets and counts by direction", () => {
  const domain: [string, string] = ["2026-01-01", "2026-01-11"]; // 10 days over 100px: 10px a day
  const ticks = [
    { id: "a", at: "2026-01-01", type: "supports" as const },
    { id: "b", at: "2026-01-02", type: "contradicts" as const },
    { id: "c", at: "2026-01-02" },
    { id: "e", at: "2026-01-03", type: "neutral" as const },
    { id: "d", at: "2026-01-11", type: "supports" as const },
  ];
  const bins = binTicks(ticks, domain, 100, 25);
  expect(bins.map((b) => [b.x, b.supports, b.contradicts, b.neutral, b.unclassified])).toEqual([
    [0, 1, 1, 1, 1],
    [75, 1, 0, 0, 0],
  ]);
  expect(bins[0]!.from).toBe("2026-01-01");
});
