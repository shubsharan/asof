import type { Direction, Evidence, HypothesisVersion } from "./types";
import { day } from "./timeline";
import { knownAt } from "./thesis";
import type { HistoryMode } from "./research";

// One slice per assessment day. Inside a slice every row has a marker (its assessment as of that day,
// fresh if made that day, carried if older) and the evidence that became knowable since the previous
// slice, stacked by direction. Days are UTC day strings, like everything in timeline.ts.

/** Anything the slice chart can track: a company on a hypothesis, or a hypothesis for a company. */
export type SliceRow = {
  id: string;
  label: string;
  href?: string;
  history: HypothesisVersion[];
  evidence: Evidence[];
  mode?: HistoryMode;
};

/** A row's assessment as it stood on a slice day. */
export type Marker = {
  /** Signed confidence: +confidence when supports, −confidence when contradicts, 0 when neutral. */
  lean: number;
  confidence: number;
  verdict: Direction;
  /** Assessed on this slice day (true) or carried forward from an earlier day (false). */
  fresh: boolean;
  asOf: string;
  assessmentId?: number;
};

export type StackKey = Direction | "unclassified";
export type EvidenceStack = Record<StackKey, { shown: Evidence[]; overflow: number }>;
export type SliceCell = { rowId: string; marker?: Marker; evidence: EvidenceStack };
export type Slice = { day: string; cells: SliceCell[] };

/** Dots drawn per direction before the rest collapses into a "+N" label. */
export const STACK_CAP = 20;
export const STACK_KEYS: StackKey[] = ["supports", "neutral", "contradicts", "unclassified"];

/** The verdict and confidence folded into one signed number, so a flip is a sign change. */
export function lean(v: { verdict: Direction; confidence: number }): number {
  if (v.verdict === "supports") return v.confidence;
  if (v.verdict === "contradicts") return -v.confidence;
  return 0;
}

/** Distinct days on which any row was assessed, oldest first. Empty if nothing is assessed. */
export function sliceDays(rows: SliceRow[]): string[] {
  const days = rows.flatMap((r) => r.history.filter((v) => v.confidence !== undefined).map((v) => day(v.asOf)));
  return [...new Set(days)].sort();
}

function markerFor(history: HypothesisVersion[], d: string): Marker | undefined {
  const sorted = history.toSorted((a, b) => a.asOf.localeCompare(b.asOf));
  const fresh = sorted.findLast((v) => day(v.asOf) === d);
  const v = fresh ?? sorted.findLast((v) => day(v.asOf) < d);
  if (!v || v.confidence === undefined) return undefined;
  return { lean: lean({ verdict: v.verdict, confidence: v.confidence }), confidence: v.confidence, verdict: v.verdict, fresh: v === fresh, asOf: v.asOf, ...(v.id === undefined ? {} : { assessmentId: v.id }) };
}

function stackFor(evidence: Evidence[], from: string | undefined, to: string, mode: HistoryMode = "recorded"): EvidenceStack {
  const at = (e: Evidence) => mode === "recorded" ? knownAt(e) : e.publishedAt;
  const inWindow = evidence
    .filter((e) => {
      const date = at(e);
      if (!date) return false;
      const k = day(date);
      return k <= to && (from === undefined || k > from);
    })
    .toSorted((a, b) => (at(a) ?? "").localeCompare(at(b) ?? ""));
  const stack = Object.fromEntries(STACK_KEYS.map((k) => [k, { shown: [], overflow: 0 }])) as unknown as EvidenceStack;
  for (const e of inWindow) {
    const group = stack[e.type ?? "unclassified"];
    if (group.shown.length < STACK_CAP) group.shown.push(e);
    else group.overflow++;
  }
  return stack;
}

/** One slice per day: each row's marker as of that day and the evidence new since the previous day. */
export function buildSlices(rows: SliceRow[], days: string[]): Slice[] {
  return days.map((d, i) => ({
    day: d,
    cells: rows.map((r) => ({ rowId: r.id, marker: markerFor(r.history, d), evidence: stackFor(r.evidence, days[i - 1], d, r.mode) })),
  }));
}

/** The slice the cursor is on: the latest day on or before `asOf` (today when the cursor is not rewound). */
export function cursorSlice(days: string[], asOf: string | undefined, today: string): string | undefined {
  const at = asOf ?? today;
  return days.filter((d) => d <= at).at(-1);
}
