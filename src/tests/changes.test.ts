import { test, expect } from "bun:test";
import { changedThisWeek, changesLabel, isChange, lastMove } from "../domain/changes";
import type { Company, Hypothesis, HypothesisVersion } from "../domain/types";

const version = (asOf: string, confidence: number, verdict: HypothesisVersion["verdict"] = "supports"): HypothesisVersion => ({
  asOf,
  verdict,
  confidence,
  reasoning: "",
  evidenceIds: ["x"],
  openQuestions: [],
});
const hyp = (id: string, history: HypothesisVersion[]): Hypothesis => ({ id, name: id, statement: id, verdict: "untested", evidence: [], history });
const company = (hypotheses: Hypothesis[]): Company => ({ id: "c", name: "C", description: "", domain: "", hypotheses });

test("lastMove reports the delta from the previous assessment", () => {
  expect(lastMove(hyp("a", []))).toBeUndefined();
  expect(lastMove(hyp("a", [version("2026-01-01", 60)]))?.delta).toBeUndefined();
  expect(lastMove(hyp("a", [version("2026-01-01", 60), version("2026-02-01", 54)]))?.delta).toBe(-6);
});

test("isChange is true for a first assessment, a confidence move or a status move", () => {
  expect(isChange(lastMove(hyp("a", [version("2026-01-01", 60)]))!)).toBe(true);
  expect(isChange(lastMove(hyp("a", [version("2026-01-01", 60), version("2026-02-01", 60)]))!)).toBe(false);
  expect(isChange(lastMove(hyp("a", [version("2026-01-01", 60), version("2026-02-01", 60, "neutral")]))!)).toBe(true);
});

test("changedThisWeek counts moves in the 7 days up to the cursor, not older ones or flat ones", () => {
  const c = company([
    hyp("moved", [version("2026-09-01", 50), version("2026-09-24T10:00:00Z", 44)]),
    hyp("flat", [version("2026-09-01", 50), version("2026-09-24", 50)]),
    hyp("old", [version("2026-09-01", 50), version("2026-09-10", 40)]),
    hyp("first", [version("2026-09-25", 70)]),
    hyp("never", []),
  ]);
  expect(changedThisWeek(c, "2026-09-25").map((h) => h.id)).toEqual(["moved", "first"]);
  expect(changesLabel(c, "2026-09-25")).toBe("2 changed this week");
  expect(changesLabel(c, "2026-09-20")).toBe("no changes this week");
  expect(changesLabel(company([hyp("never", [])]), "2026-09-25")).toBe("untested");
});
