import { test, expect } from "bun:test";
import { buildSlices, cursorSlice, lean, sliceDays, STACK_CAP, type SliceRow } from "../domain/slices";
import type { Evidence, HypothesisVersion } from "../domain/types";

const version = (asOf: string, confidence: number, verdict: HypothesisVersion["verdict"] = "supports"): HypothesisVersion => ({
  asOf,
  verdict,
  confidence,
  reasoning: "",
  evidenceIds: ["x"],
  openQuestions: [],
});

const ev = (id: string, publishedAt: string | undefined, type?: Evidence["type"], discoveredAt = "2026-09-20"): Evidence => ({
  id,
  companyId: "acme",
  hypothesisId: "h",
  title: id,
  claim: id,
  url: `https://example.com/${id}`,
  publishedAt,
  discoveredAt,
  type,
  source: "search",
});

const row = (id: string, history: HypothesisVersion[], evidence: Evidence[] = []): SliceRow => ({ id, label: id, history, evidence });

test("lean folds verdict and confidence into a signed scalar", () => {
  expect(lean({ verdict: "supports", confidence: 80 })).toBe(80);
  expect(lean({ verdict: "contradicts", confidence: 80 })).toBe(-80);
  expect(lean({ verdict: "neutral", confidence: 90 })).toBe(0);
});

test("sliceDays are the distinct assessment days across rows, ascending", () => {
  const rows = [
    row("a", [version("2026-03-01T15:00:00Z", 50), version("2026-01-12", 40)]),
    row("b", [version("2026-03-01", 60), version("2026-06-04", 70)]),
  ];
  expect(sliceDays(rows)).toEqual(["2026-01-12", "2026-03-01", "2026-06-04"]);
});

test("sliceDays is empty when nothing is assessed", () => {
  expect(sliceDays([row("a", [])])).toEqual([]);
});

test("buildSlices marks a same-day assessment fresh, carries the previous one, and omits before the first", () => {
  const rows = [row("a", [version("2026-03-01T15:00:00Z", 81), version("2026-06-04", 58, "contradicts")]), row("b", [version("2026-01-12", 40, "neutral")])];
  const days = ["2026-01-12", "2026-03-01", "2026-06-04"];
  const slices = buildSlices(rows, days);
  expect(slices.map((s) => s.day)).toEqual(days);

  const a = slices.map((s) => s.cells[0]!.marker);
  expect(a[0]).toBeUndefined();
  expect(a[1]).toEqual({ lean: 81, confidence: 81, verdict: "supports", fresh: true, asOf: "2026-03-01T15:00:00Z" });
  expect(a[2]).toEqual({ lean: -58, confidence: 58, verdict: "contradicts", fresh: true, asOf: "2026-06-04" });

  const b = slices.map((s) => s.cells[1]!.marker);
  expect(b[0]).toEqual({ lean: 0, confidence: 40, verdict: "neutral", fresh: true, asOf: "2026-01-12" });
  expect(b[1]).toEqual({ lean: 0, confidence: 40, verdict: "neutral", fresh: false, asOf: "2026-01-12" });
  expect(b[2]?.fresh).toBe(false);
});

test("buildSlices uses the latest assessment when a day has two", () => {
  const rows = [row("a", [version("2026-03-01T09:00:00Z", 30), version("2026-03-01T17:00:00Z", 70)])];
  const [slice] = buildSlices(rows, ["2026-03-01"]);
  expect(slice!.cells[0]!.marker?.confidence).toBe(70);
});

test("buildSlices windows evidence to (previous day, this day], with the first slice open at the start", () => {
  const evidence = [
    ev("ancient", "2025-01-01", "supports"),
    ev("on-first", "2026-01-12", "contradicts"),
    ev("between", "2026-02-10", "supports"),
    ev("on-second", "2026-03-01", "neutral"),
    ev("later", "2026-05-01", "supports"),
    ev("undated", undefined, undefined, "2026-02-20"),
  ];
  const rows = [row("a", [version("2026-01-12", 50)], evidence)];
  const slices = buildSlices(rows, ["2026-01-12", "2026-03-01"]);

  const first = slices[0]!.cells[0]!.evidence;
  expect(first.supports.shown.map((e) => e.id)).toEqual(["ancient"]);
  expect(first.contradicts.shown.map((e) => e.id)).toEqual(["on-first"]);

  const second = slices[1]!.cells[0]!.evidence;
  expect(second.supports.shown.map((e) => e.id)).toEqual(["between"]);
  expect(second.neutral.shown.map((e) => e.id)).toEqual(["on-second"]);
  expect(second.unclassified.shown.map((e) => e.id)).toEqual(["undated"]);
  expect(second.contradicts.shown).toEqual([]);
});

test("buildSlices caps each stack at STACK_CAP and counts the overflow, oldest shown first", () => {
  const evidence = Array.from({ length: STACK_CAP + 5 }, (_, i) => ev(`e${i}`, `2026-01-${String(31 - (i % 28)).padStart(2, "0")}`, "supports"));
  const rows = [row("a", [version("2026-02-01", 50)], evidence)];
  const [slice] = buildSlices(rows, ["2026-02-01"]);
  const stack = slice!.cells[0]!.evidence.supports;
  expect(stack.shown).toHaveLength(STACK_CAP);
  expect(stack.overflow).toBe(5);
  const dates = stack.shown.map((e) => e.publishedAt!);
  expect(dates).toEqual(dates.toSorted());
});

test("cursorSlice is the latest day on or before the cursor", () => {
  const days = ["2026-01-12", "2026-03-01", "2026-06-04"];
  expect(cursorSlice(days, "2026-03-01", "2026-09-25")).toBe("2026-03-01");
  expect(cursorSlice(days, "2026-04-15", "2026-09-25")).toBe("2026-03-01");
  expect(cursorSlice(days, "2026-01-01", "2026-09-25")).toBeUndefined();
  expect(cursorSlice(days, undefined, "2026-09-25")).toBe("2026-06-04");
  expect(cursorSlice([], undefined, "2026-09-25")).toBeUndefined();
});
