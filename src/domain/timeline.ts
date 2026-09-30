import type { Company, Direction, Evidence, HypothesisVersion } from "./types";
import { knownAt } from "./thesis";

// Everything here works in UTC day strings ("YYYY-MM-DD"), like thesisAsOf: `Date.parse` of such a
// string is UTC midnight, so day arithmetic never depends on the machine's timezone.

const MS_PER_DAY = 86_400_000;
export const day = (iso: string) => iso.slice(0, 10);
export const todayUTC = () => day(new Date().toISOString());
export const addDays = (d: string, n: number) => day(new Date(Date.parse(day(d)) + n * MS_PER_DAY).toISOString());

/**
 * The axis every strip and the scrubber on a page share, so one cursor lines up across them. It is
 * a list of knots, oldest first: the axis start, every assessment day, today, and the axis end.
 * Checkpoints are what the reader steps between, so each gap between knots gets the same width however
 * many days it spans; days inside a gap are spaced evenly.
 */
export type Domain = [start: string, ...rest: string[]];

const START_PADDING_DAYS = 45;
const FALLBACK_SPAN_DAYS = 365;
/** The stretch before the first assessment is padding, not a gap between checkpoints: half a gap wide. */
const LEAD_IN = 0.5;

/**
 * From a little before the portfolio's first assessment (a year back if nothing is assessed yet)
 * to today, stretched if any assessment or evidence is dated later than today.
 */
export function timeDomain(companies: Company[], today: string): Domain {
  const assessed = companies.flatMap((c) => c.hypotheses.flatMap((h) => h.history.map((v) => day(v.asOf))));
  const known = companies.flatMap((c) => c.hypotheses.flatMap((h) => h.evidence.map((e) => day(knownAt(e)))));
  const first = assessed.toSorted()[0];
  const start = first ? addDays(first, -START_PADDING_DAYS) : addDays(today, -FALLBACK_SPAN_DAYS);
  const end = [today, ...assessed, ...known].toSorted().at(-1)!;
  return [start, ...new Set([...assessed, today, end].filter((d) => d > start).sort())];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Day scale over `width` pixels, even between knots and linear within each gap; both directions clamp to the domain. */
export function scale(domain: Domain, width: number) {
  const t = domain.map((d) => Date.parse(day(d)));
  if (t.length < 2) t.push(t[0]! + MS_PER_DAY);
  const weights = t.slice(1).map((_, i) => (i === 0 && t.length > 2 ? LEAD_IN : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const px = weights.reduce((acc, w) => [...acc, acc.at(-1)! + (w / total) * width], [0]);
  const gap = (i: number) => Math.min(i, t.length - 2);
  return {
    x: (iso: string) => {
      const ms = clamp(Date.parse(day(iso)), t[0]!, t.at(-1)!);
      const i = gap(t.findLastIndex((k) => k <= ms));
      return px[i]! + ((ms - t[i]!) / (t[i + 1]! - t[i]!)) * (px[i + 1]! - px[i]!);
    },
    day: (x: number) => {
      const at = clamp(x, 0, width);
      const i = gap(Math.max(0, px.findLastIndex((p) => p <= at)));
      const ms = t[i]! + ((at - px[i]!) / (px[i + 1]! - px[i]! || 1)) * (t[i + 1]! - t[i]!);
      return day(new Date(Math.round(ms / MS_PER_DAY) * MS_PER_DAY).toISOString());
    },
  };
}

/** Distinct days on which anything was assessed, up to and including today, oldest first: the checkpoints. */
export function assessmentDays(companies: Company[], today: string): string[] {
  const days = companies.flatMap((c) => c.hypotheses.flatMap((h) => h.history.map((v) => day(v.asOf))));
  return [...new Set(days)].filter((d) => d <= today).sort();
}

export type CalendarTick = { day: string; x: number; week: boolean };

/** A day is ticked where it's at least this wide; a week (its Monday) where the week is at least this wide. */
const DAY_TICK_MIN_PX = 4;
const WEEK_TICK_MIN_PX = 6;

/**
 * Regular ticks for the scrubber: every Monday, and every day wherever days are wide enough to tell
 * apart. Gaps between checkpoints are equal width but not equal length, so density varies by gap.
 */
export function calendarTicks(domain: Domain, width: number): CalendarTick[] {
  const s = scale(domain, width);
  const end = domain.at(-1)!;
  const ticks: CalendarTick[] = [];
  for (let d = domain[0]; d <= end; d = addDays(d, 1)) {
    const x = s.x(d);
    const week = new Date(Date.parse(d)).getUTCDay() === 1;
    // Measured both ways, since the scale clamps at the axis ends.
    const span = (n: number) => Math.max(s.x(addDays(d, n)) - x, x - s.x(addDays(d, -n)));
    if (week ? span(7) >= WEEK_TICK_MIN_PX : span(1) >= DAY_TICK_MIN_PX) ticks.push({ day: d, x, week });
  }
  return ticks;
}

export type Segment = {
  /** The assessment that opens this segment. */
  asOf: string;
  from: string;
  to: string;
  verdict: Direction;
  confidence: number;
};

/** Confidence holds from each assessment until the next one, and the last holds to the end of the domain. */
export function stepSegments(history: HypothesisVersion[], domain: Domain): Segment[] {
  const end = domain.at(-1)!;
  return history.flatMap((v, i) => v.confidence === undefined ? [] : [{
    asOf: v.asOf,
    from: day(v.asOf),
    to: day(history[i + 1]?.asOf ?? end),
    verdict: v.verdict,
    confidence: v.confidence,
  }]);
}

export type Tick = { id: string; at: string; type?: Direction };

/** Evidence positioned by when it became knowable; anything before the domain collapses into `earlier`. */
export function evidenceTicks(evidence: Evidence[], [start]: Domain): { ticks: Tick[]; earlier: Evidence[] } {
  const ticks: Tick[] = [];
  const earlier: Evidence[] = [];
  for (const e of evidence) {
    const at = day(knownAt(e));
    if (at < start) earlier.push(e);
    else ticks.push({ id: e.id, at, type: e.type });
  }
  return { ticks, earlier };
}

export type Bin = { from: string; to: string; x: number; supports: number; contradicts: number; neutral: number; unclassified: number };

/**
 * Ticks grouped into `binPx`-wide pixel buckets so dense evidence reads as bars, not overlapping hairlines.
 * `x` is the bucket's left edge; only non-empty buckets are returned, left to right.
 */
export function binTicks(ticks: Tick[], domain: Domain, width: number, binPx: number): Bin[] {
  const s = scale(domain, width);
  const bins = new Map<number, Bin>();
  for (const t of ticks) {
    const i = Math.min(Math.floor(s.x(t.at) / binPx), Math.ceil(width / binPx) - 1);
    let bin = bins.get(i);
    if (!bin) {
      bin = { from: s.day(i * binPx), to: s.day((i + 1) * binPx - 1), x: i * binPx, supports: 0, contradicts: 0, neutral: 0, unclassified: 0 };
      bins.set(i, bin);
    }
    bin[t.type ?? "unclassified"]++;
  }
  return [...bins.values()].sort((a, b) => a.x - b.x);
}
