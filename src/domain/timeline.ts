import type { Company, Evidence, EvidenceType, HypothesisStatus, HypothesisVersion } from "./types";
import { knownAt } from "./thesis";

// Everything here works in UTC day strings ("YYYY-MM-DD"), like thesisAsOf: `Date.parse` of such a
// string is UTC midnight, so day arithmetic never depends on the machine's timezone.

const MS_PER_DAY = 86_400_000;
export const day = (iso: string) => iso.slice(0, 10);
export const todayUTC = () => day(new Date().toISOString());
export const addDays = (d: string, n: number) => day(new Date(Date.parse(day(d)) + n * MS_PER_DAY).toISOString());

/** The span every strip and the scrubber on a page share, so one cursor lines up across them. */
export type Domain = [start: string, end: string];

const START_PADDING_DAYS = 45;
const FALLBACK_SPAN_DAYS = 365;

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
  return [start, end];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Linear day scale over `width` pixels; both directions clamp to the domain. */
export function scale([start, end]: Domain, width: number) {
  const t0 = Date.parse(start);
  const span = Math.max(MS_PER_DAY, Date.parse(end) - t0);
  return {
    x: (iso: string) => clamp(((Date.parse(day(iso)) - t0) / span) * width, 0, width),
    day: (x: number) => {
      const ms = t0 + (clamp(x, 0, width) / width) * span;
      return day(new Date(Math.round(ms / MS_PER_DAY) * MS_PER_DAY).toISOString());
    },
  };
}

/** Distinct days on which anything was assessed, before today, oldest first. Today is its own cursor stop. */
export function assessmentDays(companies: Company[], today: string): string[] {
  const days = companies.flatMap((c) => c.hypotheses.flatMap((h) => h.history.map((v) => day(v.asOf))));
  return [...new Set(days)].filter((d) => d < today).sort();
}

export type Lens = { key: string; statement: string };

/** The shared hypotheses, in the order they first appear; the first company's statement stands for the lens. */
export function lensesOf(companies: Company[]): Lens[] {
  const seen = new Map<string, Lens>();
  for (const c of companies) {
    for (const h of c.hypotheses) if (!seen.has(h.lens)) seen.set(h.lens, { key: h.lens, statement: h.statement });
  }
  return [...seen.values()];
}

export type Segment = {
  /** The assessment that opens this segment. */
  asOf: string;
  from: string;
  to: string;
  confidence: number;
  status: HypothesisStatus;
};

/** Confidence holds from each assessment until the next one, and the last holds to the end of the domain. */
export function stepSegments(history: HypothesisVersion[], [, end]: Domain): Segment[] {
  return history.map((v, i) => ({
    asOf: v.asOf,
    from: day(v.asOf),
    to: day(history[i + 1]?.asOf ?? end),
    confidence: v.confidence,
    status: v.status,
  }));
}

export type Tick = { id: string; at: string; type?: EvidenceType };

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
