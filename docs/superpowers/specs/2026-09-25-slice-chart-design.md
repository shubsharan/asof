# Slice chart: hypotheses over time in isometric slices

**Date:** 2026-09-25
**Status:** approved design, awaiting implementation plan

## Purpose

Show how a set of hypothesis assessments moves through time in one picture. The chart is a stack of
isometric "slices", one per assessment day. Inside a slice, each tracked row (a company, or a
hypothesis) has a column: the assessment sits as a marker at its *lean*, and the evidence that became
knowable since the previous slice stacks around the zero line. Trails join a row's markers across
slices, so a dot moving through time is a visible path.

This is a zoom level of the existing "one time axis, one cursor" idea in another projection, not a new
page: it lives above the strip rows on the single-hypothesis page and on the company page, and the
header scrubber's cursor highlights a slice.

## Decisions made with the user

- **Do not revert to probability semantics.** Confidence stays "confidence in the verdict". The chart
  derives a signed scalar, the lean: `supports → +confidence`, `contradicts → −confidence`,
  `neutral → 0`. The zero line is drawn; crossing it between slices is a verdict flip. Confidence on
  neutral verdicts is preserved visually as the marker's halo size and numerically in the tooltip.
- **Layered dots (option C):** the evidence swarm is a faint cloud, the assessment is the bold marker.
- **Two row sets, one component:** one hypothesis across companies (hypothesis page), one company
  across hypotheses (company page). The whole-portfolio variant is out of scope.
- **One column per row, not a continuous x.** Dots only move vertically; trails stay legible.
- **Slices are assessment days,** not calendar intervals. Evenly spaced in depth, date labeled.
- **Plain SVG with a fixed isometric camera.** No three.js, no CSS 3D, no new dependency.

## 1. Data layer: `src/domain/slices.ts`

Pure functions, tested with `bun test`. UTC day strings throughout, like `timeline.ts`.

```ts
export type SliceRow = {
  id: string;
  label: string;          // company name, or lensName(hypothesis)
  href?: string;
  history: HypothesisVersion[];
  evidence: Evidence[];
};

export type Marker = {
  lean: number;           // −100..100
  confidence: number;
  verdict: Direction;
  fresh: boolean;         // assessed on this slice day (true) or carried from an earlier one (false)
  asOf: string;           // the assessment's asOf, for tooltips and links
};

export type EvidenceStack = Record<Direction | "unclassified", { shown: Evidence[]; overflow: number }>;

export type SliceCell = { rowId: string; marker?: Marker; evidence: EvidenceStack };
export type Slice = { day: string; cells: SliceCell[] };
```

Functions:

- `lean(v: Pick<HypothesisVersion, "verdict" | "confidence">): number`
- `sliceDays(rows: SliceRow[]): string[]` — distinct `day(v.asOf)` across all rows' histories, sorted
  ascending. Today is included only if something was assessed today. Empty if nothing is assessed.
- `buildSlices(rows: SliceRow[], days: string[]): Slice[]` — for each day and row:
  - marker: the version whose `day(asOf) === day` (fresh), else the latest version before that day
    (carried), else none.
  - evidence: items with `knownAt(e)` in `(previousDay, day]` (for the first slice: everything on or
    before it), grouped by `e.type ?? "unclassified"`. Each group keeps the first `STACK_CAP = 20`
    items (sorted by knownAt) in `shown` and the remainder count in `overflow`.
- `cursorSlice(days: string[], asOf: string | undefined, today: string): string | undefined` — the
  latest day `<= (asOf ?? today)`; undefined if none.
- `companyRows(companies: Company[], hypothesisId: string): SliceRow[]` and
  `hypothesisRows(company: Company): SliceRow[]` — adapters that drop rows with empty history and
  set `href` with `companyHypothesisPath`. Row order is the portfolio's order.

## 2. Projection: `src/domain/isometric.ts`

Standard 30° isometric. Chart space is `(column u, lean v, slice depth w)`.

```ts
export const ISO = {
  columnPitch: 64,   // px along the column axis per row
  sliceDepth: 110,   // px along the time axis per slice
  planeHeight: 200,  // px for lean −100..100
  columnInset: 32,   // gap from the panel edge to the first/last column
  dotPitch: 7,       // vertical spacing of evidence dots
  markerRadius: 5,
  haloMax: 16,       // halo radius at 100% confidence
};

export function project(u: number, v: number, w: number): { x: number; y: number };
```

Axes on screen: the time axis (w) runs down-right, so the oldest slice is back-left and the newest is
front-right. The column axis (u) runs down-left across each slice. Lean (v) is straight up. The
function is pure; a `bounds(slices, columns)` helper returns the enclosing box so the component can
set its viewBox.

## 3. Component: `src/components/SliceChart.tsx`

```ts
type Props = {
  rows: SliceRow[];
  asOf?: string;
  today: string;
  onPickDate: (day: string) => void;
  avatar?: (rowId: string) => ReactNode;  // hypothesis page looks the company up by id and returns CompanyAvatar; company page omits it
};
```

Rendering, in draw order (back slice to front slice):

1. Panel: translucent parallelogram with a border, the slice date at its top corner, a zero line
   across the plane at lean 0.
2. Per column, the evidence stack: supporting dots pile upward from the zero line, contradicting
   dots pile downward, neutral and unclassified dots sit along the zero line offset sideways. Colors
   from `DIRECTION[...].fill`, unclassified muted. Overflow renders as a small `+N` label at the top or
   bottom of the stack.
3. Per column, the marker: a translucent halo (radius `markerRadius + haloMax × confidence/100`, same
   fill at low opacity), then the dot: filled with the verdict color when fresh, hollow (verdict-colored
   stroke, background fill) when carried. A `<title>` gives date, verdict, confidence and whether it was
   carried.
4. Trail from this slice's marker to the next slice's marker for each row, drawn *before* the next
   panel so it dims behind it. Muted stroke; uses the next marker's verdict color when the verdict
   changed, so flips stand out.

Cursor: the slice returned by `cursorSlice` gets an emphasized border and full opacity; every other
slice is drawn at reduced opacity. Clicking a panel calls `onPickDate(day)`. Clicking a marker follows
`row.href` if set.

Labels: column labels (avatar + label) along the front slice's base, one per row. A one-line legend
under the chart: filled dot = assessed that day, hollow = carried, halo = confidence, small dots =
evidence new since the previous slice.

Layout: `useWidth` measures the container; the SVG uses a computed viewBox from `bounds` and scales
to the container width, with `min-width: 640px` inside an `overflow-x-auto` wrapper so phones pan.

Empty state: with no slice days the component renders nothing (the pages already say "not assessed").

## 4. Integration

- `Hypotheses.tsx`: when `hypothesisId` is set, render `<SliceChart rows={companyRows(companies, id)} avatar={(rowId) => <CompanyAvatar company={byId(rowId)} />} … />`
  between the heading and the strip rows. The all-hypotheses list does not get a chart.
- `Company.tsx`: render `<SliceChart rows={hypothesisRows(full)} … />` between the header and the
  strip rows.
- Both pages pass `asOf`, `today` from `useAsOf()` and `setAsOf` as `onPickDate`.
- Untested rows are already omitted (adapters drop empty histories) and stay listed below the chart.

## Testing

`bun test` covers `slices.ts` and `isometric.ts`:

- lean mapping for all three verdicts
- sliceDays: dedupe, sort, today included only when assessed, empty when unassessed
- buildSlices: fresh vs carried vs absent markers; evidence windowing including the first slice's
  open start; the cap and overflow count; unclassified grouping
- cursorSlice: exact day, between days, before the first day, cursor on today
- project: origin, unit steps along each axis, and bounds for a small grid

The component is verified in the browser preview on `/hypotheses/moat`, `/c/exa`, at phone width, and
with the scrubber rewound to each assessment day. The repo has no DOM tests and this design adds none.

## Out of scope

- Whole-portfolio chart (20 rows per slice)
- Orbit/rotation, WebGL
- Calendar-interval slices
- Any change to the data model or backfill
