import type { Company, Hypothesis, HypothesisVersion } from "./types";
import { addDays, day } from "./timeline";

const WEEK_DAYS = 7;

export type Move = {
  /** The assessment that made the move. */
  to: HypothesisVersion;
  /** The one before it; absent for a first assessment. */
  from?: HypothesisVersion;
  /** Confidence change in points; absent for a first assessment. */
  delta?: number;
};

/** What the latest assessment (on or before `asOf`, if given) did to the hypothesis; undefined when never assessed. */
export function lastMove(h: Hypothesis, asOf?: string): Move | undefined {
  const history = asOf ? h.history.filter((v) => day(v.asOf) <= day(asOf)) : h.history;
  const to = history.at(-1);
  if (!to) return undefined;
  const from = history.at(-2);
  return { to, from, delta: from ? to.confidence - from.confidence : undefined };
}

/** A move that changed confidence or verdict, or a first assessment: something the reader should notice. */
export const isChange = (m: Move) => !m.from || m.delta !== 0 || m.from.verdict !== m.to.verdict;

/** Hypotheses whose latest assessment fell in the 7 days up to `asOf` and changed something. */
export function changedThisWeek(company: Company, asOf: string): Hypothesis[] {
  const since = addDays(asOf, -WEEK_DAYS);
  return company.hypotheses.filter((h) => {
    const m = lastMove(h, asOf);
    return m && day(m.to.asOf) > since && isChange(m);
  });
}

/** "2 changed this week", "no changes this week", or "untested" when nothing was ever assessed. */
export function changesLabel(company: Company, asOf: string): string {
  if (!company.hypotheses.some((h) => lastMove(h, asOf))) return "untested";
  const n = changedThisWeek(company, asOf).length;
  return n === 0 ? "no changes this week" : `${n} changed this week`;
}
