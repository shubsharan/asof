# Slice Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An isometric chart of stacked time slices showing how a set of hypothesis assessments (companies on one hypothesis, or hypotheses for one company) move through time, placed above the strip rows on the hypothesis page and the company page.

**Architecture:** Two pure domain modules (`slices.ts` builds per-day cells with a marker and an evidence stack; `isometric.ts` projects chart space to screen space) feed one plain-SVG React component, `SliceChart`. Two small adapters turn the portfolio's `Company[]` into the component's row shape. The header scrubber's cursor selects the highlighted slice; clicking a slice moves the cursor.

**Tech Stack:** Bun, React 19, TypeScript, Tailwind 4, `bun test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-25-slice-chart-design.md`

## Global Constraints

- Bun for everything: `bun test`, `bun run dev`, `bunx tsc --noEmit -p tsconfig.json` for typechecking. Never node/npm/npx.
- No new dependencies. Plain SVG, no three.js, no CSS 3D.
- Day math is UTC day strings (`YYYY-MM-DD`) via `day()` from `src/domain/timeline.ts`; evidence dates come from `knownAt()` in `src/domain/thesis.ts`.
- The lean fold is exactly: `supports → +confidence`, `contradicts → −confidence`, `neutral → 0`. The data model does not change.
- Colors come only from the `DIRECTION` map in `src/components/shared.tsx` (`.fill`, `.stroke`). Unclassified evidence uses `DIRECTION.unclassified`.
- Evidence stacks cap at 20 per direction (`STACK_CAP`), overflow shown as `+N`.
- The chart renders nothing when there are no assessment days.
- Domain modules (`src/domain/*`) must not import from `src/components/*`.
- Commit messages are plain conventional-commit lines with no attribution trailer.

---

## File structure

| File | Responsibility |
|---|---|
| `src/domain/slices.ts` (create) | Row type, lean, slice days, per-day markers and evidence stacks, cursor slice resolution |
| `src/domain/isometric.ts` (create) | Isometric projection, chart-space helpers (column/lean/depth), panel corners, viewBox bounds |
| `src/components/sliceRows.ts` (create) | Adapters: `Company[]` → rows for a hypothesis; one `Company` → rows for its hypotheses |
| `src/components/SliceChart.tsx` (create) | The SVG chart: panels, evidence stacks, markers, trails, cursor highlight, column labels, legend |
| `src/components/Hypotheses.tsx` (modify) | Render the chart on the single-hypothesis page |
| `src/components/Company.tsx` (modify) | Render the chart on the company page |
| `src/tests/slices.test.ts`, `src/tests/isometric.test.ts`, `src/tests/sliceRows.test.ts` (create) | Unit tests |

Existing helpers you will use (do not reimplement):

- `day(iso)` and `todayUTC()` in `src/domain/timeline.ts`
- `knownAt(e)` in `src/domain/thesis.ts` (publishedAt, else discoveredAt)
- `DIRECTION`, `formatDate`, `withAsOf`, `CompanyAvatar` in `src/components/shared.tsx`
- `useWidth()` in `src/components/useWidth.ts` (returns `[ref, width]`, width is 0 until measured)
- `useAsOf()` in `src/components/asof.ts` (returns `{ asOf, setAsOf, today }`; `asOf` undefined means today)
- `companyHypothesisPath(companyId, hypothesisId)` in `src/components/routes.ts`
- Types in `src/domain/types.ts`: `Company`, `Hypothesis` (has `name`, `history`, `evidence`), `HypothesisVersion` (`asOf`, `verdict`, `confidence`), `Evidence` (`type?`, `publishedAt?`, `discoveredAt`), `Direction`

---

### Task 1: Slice data layer

**Files:**
- Create: `src/domain/slices.ts`
- Test: `src/tests/slices.test.ts`

**Interfaces:**
- Consumes: `day` from `./timeline`, `knownAt` from `./thesis`, types from `./types`.
- Produces (used by Tasks 3 and 4):
  ```ts
  export type SliceRow = { id: string; label: string; href?: string; history: HypothesisVersion[]; evidence: Evidence[] };
  export type Marker = { lean: number; confidence: number; verdict: Direction; fresh: boolean; asOf: string };
  export type StackKey = Direction | "unclassified";
  export type EvidenceStack = Record<StackKey, { shown: Evidence[]; overflow: number }>;
  export type SliceCell = { rowId: string; marker?: Marker; evidence: EvidenceStack };
  export type Slice = { day: string; cells: SliceCell[] };
  export const STACK_CAP: number;               // 20
  export const STACK_KEYS: StackKey[];
  export function lean(v: Pick<HypothesisVersion, "verdict" | "confidence">): number;
  export function sliceDays(rows: SliceRow[]): string[];
  export function buildSlices(rows: SliceRow[], days: string[]): Slice[];
  export function cursorSlice(days: string[], asOf: string | undefined, today: string): string | undefined;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/tests/slices.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/tests/slices.test.ts`
Expected: FAIL, "Cannot find module '../domain/slices'".

- [ ] **Step 3: Write the implementation**

Create `src/domain/slices.ts`:

```ts
import type { Direction, Evidence, HypothesisVersion } from "./types";
import { day } from "./timeline";
import { knownAt } from "./thesis";

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
};

export type StackKey = Direction | "unclassified";
export type EvidenceStack = Record<StackKey, { shown: Evidence[]; overflow: number }>;
export type SliceCell = { rowId: string; marker?: Marker; evidence: EvidenceStack };
export type Slice = { day: string; cells: SliceCell[] };

/** Dots drawn per direction before the rest collapses into a "+N" label. */
export const STACK_CAP = 20;
export const STACK_KEYS: StackKey[] = ["supports", "neutral", "contradicts", "unclassified"];

/** The verdict and confidence folded into one signed number, so a flip is a sign change. */
export function lean(v: Pick<HypothesisVersion, "verdict" | "confidence">): number {
  if (v.verdict === "supports") return v.confidence;
  if (v.verdict === "contradicts") return -v.confidence;
  return 0;
}

/** Distinct days on which any row was assessed, oldest first. Empty if nothing is assessed. */
export function sliceDays(rows: SliceRow[]): string[] {
  const days = rows.flatMap((r) => r.history.map((v) => day(v.asOf)));
  return [...new Set(days)].sort();
}

function markerFor(history: HypothesisVersion[], d: string): Marker | undefined {
  const sorted = history.toSorted((a, b) => a.asOf.localeCompare(b.asOf));
  const fresh = sorted.findLast((v) => day(v.asOf) === d);
  const v = fresh ?? sorted.findLast((v) => day(v.asOf) < d);
  if (!v) return undefined;
  return { lean: lean(v), confidence: v.confidence, verdict: v.verdict, fresh: v === fresh, asOf: v.asOf };
}

function stackFor(evidence: Evidence[], from: string | undefined, to: string): EvidenceStack {
  const inWindow = evidence
    .filter((e) => {
      const k = day(knownAt(e));
      return k <= to && (from === undefined || k > from);
    })
    .toSorted((a, b) => knownAt(a).localeCompare(knownAt(b)));
  const stack = Object.fromEntries(STACK_KEYS.map((k) => [k, { shown: [], overflow: 0 }])) as EvidenceStack;
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
    cells: rows.map((r) => ({ rowId: r.id, marker: markerFor(r.history, d), evidence: stackFor(r.evidence, days[i - 1], d) })),
  }));
}

/** The slice the cursor is on: the latest day on or before `asOf` (today when the cursor is not rewound). */
export function cursorSlice(days: string[], asOf: string | undefined, today: string): string | undefined {
  const at = asOf ?? today;
  return days.filter((d) => d <= at).at(-1);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/tests/slices.test.ts`
Expected: 8 pass, 0 fail.

- [ ] **Step 5: Typecheck and commit**

Run: `bunx tsc --noEmit -p tsconfig.json` (expected: no output, exit 0)

```bash
git add src/domain/slices.ts src/tests/slices.test.ts
git commit -m "feat: slice data layer for the isometric chart"
```

---

### Task 2: Isometric projection

**Files:**
- Create: `src/domain/isometric.ts`
- Test: `src/tests/isometric.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 4):
  ```ts
  export const ISO: { columnPitch: number; sliceDepth: number; planeHeight: number; columnInset: number; dotPitch: number; dotRadius: number; markerRadius: number; haloMax: number };
  export type Point = { x: number; y: number };
  export type Box = { x: number; y: number; width: number; height: number };
  export function project(u: number, v: number, w: number): Point;   // u column axis, v lean axis (up), w time axis
  export const columnU: (i: number) => number;
  export const planeWidth: (columns: number) => number;
  export const leanV: (lean: number) => number;                      // lean −100..100 → −planeHeight/2..+planeHeight/2
  export const sliceW: (k: number) => number;
  export function panelCorners(columns: number, k: number): Point[]; // 4 corners: top-right, top-left, bottom-left, bottom-right (on screen)
  export function bounds(columns: number, slices: number): Box;      // viewBox enclosing every panel plus label padding
  export const toPoints: (pts: Point[]) => string;                   // "x,y x,y ..." for <polygon points>
  ```

Screen convention: standard 30° isometric. The time axis `w` runs down-right (newest slice front-right), the column axis `u` runs down-left across a slice, the lean axis `v` is straight up. Larger screen `y` is closer to the viewer.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/isometric.test.ts`:

```ts
import { test, expect } from "bun:test";
import { bounds, columnU, ISO, leanV, panelCorners, planeWidth, project, sliceW, toPoints } from "../domain/isometric";

const COS30 = Math.sqrt(3) / 2;

test("project maps the origin to the origin and each axis to its isometric direction", () => {
  expect(project(0, 0, 0)).toEqual({ x: 0, y: 0 });
  const u = project(1, 0, 0);
  expect(u.x).toBeCloseTo(-COS30);
  expect(u.y).toBeCloseTo(0.5);
  const v = project(0, 1, 0);
  expect(v.x).toBeCloseTo(0);
  expect(v.y).toBeCloseTo(-1);
  const w = project(0, 0, 1);
  expect(w.x).toBeCloseTo(COS30);
  expect(w.y).toBeCloseTo(0.5);
});

test("chart-space helpers place columns, leans and slices by the ISO constants", () => {
  expect(columnU(0)).toBe(ISO.columnInset);
  expect(columnU(2)).toBe(ISO.columnInset + 2 * ISO.columnPitch);
  expect(planeWidth(1)).toBe(2 * ISO.columnInset);
  expect(planeWidth(5)).toBe(2 * ISO.columnInset + 4 * ISO.columnPitch);
  expect(leanV(100)).toBe(ISO.planeHeight / 2);
  expect(leanV(-50)).toBe(-ISO.planeHeight / 4);
  expect(leanV(0)).toBe(0);
  expect(sliceW(3)).toBe(3 * ISO.sliceDepth);
});

test("panelCorners is the projected rectangle of a slice, top-right first", () => {
  const [tr, tl, bl, br] = panelCorners(1, 0);
  const H = ISO.planeHeight / 2;
  const W = planeWidth(1);
  expect(tr).toEqual(project(0, H, 0));
  expect(tl).toEqual(project(W, H, 0));
  expect(bl).toEqual(project(W, -H, 0));
  expect(br).toEqual(project(0, -H, 0));
});

test("bounds encloses every panel and grows with more slices", () => {
  const one = bounds(1, 1);
  const two = bounds(1, 2);
  expect(two.width).toBeGreaterThan(one.width);
  expect(two.height).toBeGreaterThan(one.height);
  for (const k of [0, 1]) {
    for (const p of panelCorners(1, k)) {
      expect(p.x).toBeGreaterThanOrEqual(two.x);
      expect(p.x).toBeLessThanOrEqual(two.x + two.width);
      expect(p.y).toBeGreaterThanOrEqual(two.y);
      expect(p.y).toBeLessThanOrEqual(two.y + two.height);
    }
  }
});

test("toPoints formats a polygon attribute to one decimal", () => {
  expect(toPoints([{ x: 1, y: 2 }, { x: -3.456, y: 7.891 }])).toBe("1.0,2.0 -3.5,7.9");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/tests/isometric.test.ts`
Expected: FAIL, "Cannot find module '../domain/isometric'".

- [ ] **Step 3: Write the implementation**

Create `src/domain/isometric.ts`:

```ts
// Chart space for the slice chart is (u, v, w): u runs along a slice across its columns, v is the
// lean (up), w is the time axis stacking slices in depth. Screen space is a standard 30° isometric
// projection with w running down-right and u down-left, so the newest slice is front-right and larger
// screen y is nearer the viewer. Everything tunable about the look lives in ISO.

export const ISO = {
  /** Pixels along the column axis per row. */
  columnPitch: 64,
  /** Pixels along the time axis per slice. */
  sliceDepth: 120,
  /** Pixels of plane height for lean −100..100. */
  planeHeight: 200,
  /** Gap from the panel edge to the first and last column. */
  columnInset: 36,
  /** Vertical spacing of evidence dots in a stack. */
  dotPitch: 5,
  dotRadius: 2,
  markerRadius: 5,
  /** Extra halo radius at 100% confidence. */
  haloMax: 16,
};

/** Padding around the panels for the date labels (top/right) and column labels (bottom/left). */
export const PAD = { top: 24, right: 16, bottom: 48, left: 150 };

const COS = Math.sqrt(3) / 2;
const SIN = 0.5;

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

export function project(u: number, v: number, w: number): Point {
  return { x: COS * (w - u), y: SIN * (w + u) - v };
}

export const columnU = (i: number) => ISO.columnInset + i * ISO.columnPitch;
export const planeWidth = (columns: number) => 2 * ISO.columnInset + Math.max(0, columns - 1) * ISO.columnPitch;
export const leanV = (lean: number) => (lean / 100) * (ISO.planeHeight / 2);
export const sliceW = (k: number) => k * ISO.sliceDepth;

/** The four corners of slice `k`'s plane: top-right, top-left, bottom-left, bottom-right on screen. */
export function panelCorners(columns: number, k: number): Point[] {
  const W = planeWidth(columns);
  const H = ISO.planeHeight / 2;
  const w = sliceW(k);
  return [project(0, H, w), project(W, H, w), project(W, -H, w), project(0, -H, w)];
}

/** A viewBox enclosing every panel plus room for labels. */
export function bounds(columns: number, slices: number): Box {
  const pts = Array.from({ length: Math.max(1, slices) }, (_, k) => panelCorners(columns, k)).flat();
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs) - PAD.left;
  const y = Math.min(...ys) - PAD.top;
  return { x, y, width: Math.max(...xs) + PAD.right - x, height: Math.max(...ys) + PAD.bottom - y };
}

export const toPoints = (pts: Point[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/tests/isometric.test.ts`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Typecheck and commit**

Run: `bunx tsc --noEmit -p tsconfig.json` (expected: exit 0)

```bash
git add src/domain/isometric.ts src/tests/isometric.test.ts
git commit -m "feat: isometric projection for the slice chart"
```

---

### Task 3: Row adapters

**Files:**
- Create: `src/components/sliceRows.ts`
- Test: `src/tests/sliceRows.test.ts`

**Interfaces:**
- Consumes: `SliceRow` from `@/domain/slices`, `Company` from `@/domain/types`, `companyHypothesisPath` from `./routes`.
- Produces (used by Task 5):
  ```ts
  export function companyRows(companies: Company[], hypothesisId: string): SliceRow[]; // one row per company assessed on that hypothesis, portfolio order
  export function hypothesisRows(company: Company): SliceRow[];                        // one row per hypothesis the company has been assessed on, portfolio order
  ```

This file lives under `src/components/` (not `src/domain/`) because it builds links with `routes.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/tests/sliceRows.test.ts`:

```ts
import { test, expect } from "bun:test";
import { companyRows, hypothesisRows } from "../components/sliceRows";
import type { Company, HypothesisVersion } from "../domain/types";

const version = (asOf: string): HypothesisVersion => ({ asOf, verdict: "supports", confidence: 50, reasoning: "", evidenceIds: ["x"], openQuestions: [] });

const company = (id: string, hypotheses: Company["hypotheses"]): Company => ({ id, name: id.toUpperCase(), description: "", domain: "", hypotheses });
const hyp = (id: string, history: HypothesisVersion[]): Company["hypotheses"][number] => ({ id, name: id[0]!.toUpperCase() + id.slice(1), statement: `${id} statement`, verdict: "untested", history, evidence: [] });

const acme = company("acme", [hyp("moat", [version("2026-03-01")]), hyp("adoption", [])]);
const beta = company("beta", [hyp("moat", []), hyp("adoption", [version("2026-01-12")])]);

test("companyRows gives one row per company assessed on the hypothesis, in portfolio order, linked", () => {
  const rows = companyRows([acme, beta], "moat");
  expect(rows.map((r) => r.id)).toEqual(["acme"]);
  expect(rows[0]).toMatchObject({ label: "ACME", href: "/c/acme/h/moat" });
  expect(rows[0]!.history).toHaveLength(1);
  expect(companyRows([acme, beta], "adoption").map((r) => r.id)).toEqual(["beta"]);
  expect(companyRows([acme, beta], "missing")).toEqual([]);
});

test("hypothesisRows gives one row per assessed hypothesis with its short name, linked", () => {
  const rows = hypothesisRows(acme);
  expect(rows.map((r) => r.id)).toEqual(["moat"]);
  expect(rows[0]).toMatchObject({ label: "Moat", href: "/c/acme/h/moat" });
  expect(hypothesisRows(company("empty", []))).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/tests/sliceRows.test.ts`
Expected: FAIL, "Cannot find module '../components/sliceRows'".

- [ ] **Step 3: Write the implementation**

Create `src/components/sliceRows.ts`:

```ts
import type { SliceRow } from "@/domain/slices";
import type { Company } from "@/domain/types";
import { companyHypothesisPath } from "./routes";

// The slice chart draws rows; a page decides what a row is. Rows with no assessment are dropped here,
// so the pages keep listing them as "not assessed yet" below the chart.

/** One row per company that has been assessed on `hypothesisId`, in portfolio order. */
export function companyRows(companies: Company[], hypothesisId: string): SliceRow[] {
  return companies.flatMap((c) => {
    const h = c.hypotheses.find((x) => x.id === hypothesisId);
    if (!h || h.history.length === 0) return [];
    return [{ id: c.id, label: c.name, href: companyHypothesisPath(c.id, h.id), history: h.history, evidence: h.evidence }];
  });
}

/** One row per hypothesis the company has been assessed on, titled by the hypothesis's short name. */
export function hypothesisRows(company: Company): SliceRow[] {
  return company.hypotheses
    .filter((h) => h.history.length > 0)
    .map((h) => ({ id: h.id, label: h.name, href: companyHypothesisPath(company.id, h.id), history: h.history, evidence: h.evidence }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/tests/sliceRows.test.ts`
Expected: 2 pass, 0 fail.

- [ ] **Step 5: Typecheck and commit**

Run: `bunx tsc --noEmit -p tsconfig.json` (expected: exit 0)

```bash
git add src/components/sliceRows.ts src/tests/sliceRows.test.ts
git commit -m "feat: row adapters for the slice chart"
```

---

### Task 4: SliceChart component

**Files:**
- Create: `src/components/SliceChart.tsx`

**Interfaces:**
- Consumes: everything exported by Tasks 1 and 2; `DIRECTION`, `formatDate`, `withAsOf` from `./shared`; `useWidth` from `./useWidth`.
- Produces (used by Task 5):
  ```tsx
  export function SliceChart(props: {
    rows: SliceRow[];
    asOf?: string;                       // the cursor; undefined means today
    today: string;
    onPickDate: (day: string) => void;   // clicking a slice panel
    avatar?: (rowId: string) => ReactNode;
  }): JSX.Element | null;
  ```

There is no DOM test harness in the repo; this task is verified by typecheck here and in the browser in Task 5.

- [ ] **Step 1: Write the component**

Create `src/components/SliceChart.tsx`:

```tsx
import { useMemo, type ReactNode } from "react";
import { bounds, columnU, ISO, leanV, panelCorners, planeWidth, project, sliceW, toPoints, type Point } from "@/domain/isometric";
import { buildSlices, cursorSlice, sliceDays, type Marker, type Slice, type SliceCell, type SliceRow, type StackKey } from "@/domain/slices";
import { DIRECTION, formatDate, withAsOf } from "./shared";
import { useWidth } from "./useWidth";

/**
 * Hypotheses over time as a stack of isometric slices, one per assessment day. Each row has a column;
 * its assessment sits at its lean (signed confidence: up supports, down contradicts) and the evidence
 * that became knowable since the previous slice stacks around the zero line. Trails join a row's
 * markers across slices. The slice on the cursor is emphasized; clicking a slice moves the cursor.
 *
 * Renders nothing until a row has been assessed. Draws back-to-front so the newest slice occludes.
 */
type Props = {
  rows: SliceRow[];
  /** The cursor; undefined means today. */
  asOf?: string;
  today: string;
  onPickDate: (day: string) => void;
  avatar?: (rowId: string) => ReactNode;
};

const MIN_WIDTH = 640;
const LABEL_WIDTH = 140;
const LABEL_HEIGHT = 24;

export function SliceChart({ rows, asOf, today, onPickDate, avatar }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const days = useMemo(() => sliceDays(rows), [rows]);
  const slices = useMemo(() => buildSlices(rows, days), [rows, days]);
  if (days.length === 0) return null;

  const cursor = cursorSlice(days, asOf, today);
  const box = bounds(rows.length, days.length);
  const height = (box.height / box.width) * width;

  return (
    <div className="overflow-x-auto">
      <div ref={ref} style={{ minWidth: MIN_WIDTH }}>
        {width > 0 && (
          <svg viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} width={width} height={height} className="block">
            {slices.map((slice, k) => (
              <g key={slice.day}>
                <Panel slice={slice} k={k} rows={rows} active={slice.day === cursor} asOf={asOf} onPick={onPickDate} />
                {k < slices.length - 1 && <Trails from={slice} to={slices[k + 1]!} k={k} rows={rows} />}
              </g>
            ))}
            <ColumnLabels rows={rows} k={slices.length - 1} asOf={asOf} avatar={avatar} />
          </svg>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Filled dot: assessed that day. Hollow: carried from an earlier assessment. Halo: confidence. Small dots: evidence new since the previous slice, up from the line supports, down contradicts.
        </p>
      </div>
    </div>
  );
}

function Panel({ slice, k, rows, active, asOf, onPick }: { slice: Slice; k: number; rows: SliceRow[]; active: boolean; asOf?: string; onPick: (day: string) => void }) {
  const w = sliceW(k);
  const [z0, z1] = [project(0, 0, w), project(planeWidth(rows.length), 0, w)];
  const topRight = project(0, ISO.planeHeight / 2, w);
  return (
    <g className={active ? undefined : "opacity-60"}>
      <polygon
        points={toPoints(panelCorners(rows.length, k))}
        className={`cursor-pointer fill-foreground/[0.04] ${active ? "stroke-foreground" : "stroke-border"}`}
        strokeWidth={active ? 1.5 : 1}
        onClick={() => onPick(slice.day)}
      >
        <title>{`Set the cursor to ${formatDate(slice.day)}`}</title>
      </polygon>
      <line x1={z0.x} y1={z0.y} x2={z1.x} y2={z1.y} className="stroke-border" strokeDasharray="3 3" />
      <text x={topRight.x + 6} y={topRight.y - 6} className={`font-mono text-[11px] ${active ? "fill-foreground" : "fill-muted-foreground"}`}>
        {formatDate(slice.day)}
      </text>
      {slice.cells.map((cell, i) => (
        <Column key={cell.rowId} cell={cell} row={rows[i]!} u={columnU(i)} w={w} asOf={asOf} />
      ))}
    </g>
  );
}

const STACK_FILL: Record<StackKey, string> = {
  supports: DIRECTION.supports.fill,
  neutral: DIRECTION.neutral.fill,
  contradicts: DIRECTION.contradicts.fill,
  unclassified: DIRECTION.unclassified.fill,
};

function Column({ cell, row, u, w, asOf }: { cell: SliceCell; row: SliceRow; u: number; w: number; asOf?: string }) {
  const { supports, contradicts, neutral, unclassified } = cell.evidence;
  const dots: { p: Point; key: StackKey; title: string; id: string }[] = [];
  supports.shown.forEach((e, j) => dots.push({ p: project(u, (j + 1) * ISO.dotPitch, w), key: "supports", title: e.title, id: e.id }));
  contradicts.shown.forEach((e, j) => dots.push({ p: project(u, -(j + 1) * ISO.dotPitch, w), key: "contradicts", title: e.title, id: e.id }));
  const along = [...neutral.shown.map((e) => ({ e, key: "neutral" as StackKey })), ...unclassified.shown.map((e) => ({ e, key: "unclassified" as StackKey }))];
  along.forEach(({ e, key }, j) => dots.push({ p: project(u + (j - (along.length - 1) / 2) * ISO.dotPitch, 0, w), key, title: e.title, id: e.id }));

  const upOverflow = supports.overflow > 0 && project(u, (supports.shown.length + 1) * ISO.dotPitch + 8, w);
  const downOverflow = contradicts.overflow > 0 && project(u, -((contradicts.shown.length + 1) * ISO.dotPitch + 8), w);

  return (
    <g>
      {dots.map((d) => (
        <circle key={d.id} cx={d.p.x} cy={d.p.y} r={ISO.dotRadius} className={STACK_FILL[d.key]}>
          <title>{d.title}</title>
        </circle>
      ))}
      {upOverflow && (
        <text x={upOverflow.x} y={upOverflow.y} textAnchor="middle" className="fill-muted-foreground font-mono text-[9px]">
          +{supports.overflow}
        </text>
      )}
      {downOverflow && (
        <text x={downOverflow.x} y={downOverflow.y + 6} textAnchor="middle" className="fill-muted-foreground font-mono text-[9px]">
          +{contradicts.overflow}
        </text>
      )}
      {cell.marker && <MarkerDot marker={cell.marker} row={row} p={project(u, leanV(cell.marker.lean), w)} asOf={asOf} />}
    </g>
  );
}

function MarkerDot({ marker: m, row, p, asOf }: { marker: Marker; row: SliceRow; p: Point; asOf?: string }) {
  const tone = DIRECTION[m.verdict];
  const halo = ISO.markerRadius + (ISO.haloMax * m.confidence) / 100;
  const dot = (
    <g>
      <circle cx={p.x} cy={p.y} r={halo} className={`${tone.fill} opacity-20`} />
      {m.fresh ? (
        <circle cx={p.x} cy={p.y} r={ISO.markerRadius} className={tone.fill} />
      ) : (
        <circle cx={p.x} cy={p.y} r={ISO.markerRadius} className={`fill-background ${tone.stroke}`} strokeWidth={1.5} />
      )}
      <title>{`${row.label}, ${formatDate(m.asOf)}: ${m.verdict}, ${m.confidence}% confident${m.fresh ? "" : " (carried, not reassessed this day)"}`}</title>
    </g>
  );
  return row.href ? <a href={withAsOf(row.href, asOf)}>{dot}</a> : dot;
}

function Trails({ from, to, k, rows }: { from: Slice; to: Slice; k: number; rows: SliceRow[] }) {
  return (
    <>
      {rows.map((row, i) => {
        const a = from.cells[i]!.marker;
        const b = to.cells[i]!.marker;
        if (!a || !b) return null;
        const p = project(columnU(i), leanV(a.lean), sliceW(k));
        const q = project(columnU(i), leanV(b.lean), sliceW(k + 1));
        const flipped = a.verdict !== b.verdict;
        return (
          <line
            key={row.id}
            x1={p.x}
            y1={p.y}
            x2={q.x}
            y2={q.y}
            className={flipped ? DIRECTION[b.verdict].stroke : "stroke-muted-foreground/40"}
            strokeWidth={flipped ? 2 : 1.25}
          />
        );
      })}
    </>
  );
}

/** Row labels along the base of the front slice, each to the left of its column. */
function ColumnLabels({ rows, k, asOf, avatar }: { rows: SliceRow[]; k: number; asOf?: string; avatar?: (rowId: string) => ReactNode }) {
  return (
    <>
      {rows.map((row, i) => {
        const p = project(columnU(i), -ISO.planeHeight / 2, sliceW(k));
        return (
          <foreignObject key={row.id} x={p.x - 10 - LABEL_WIDTH} y={p.y - LABEL_HEIGHT / 2} width={LABEL_WIDTH} height={LABEL_HEIGHT}>
            <div className="flex h-full items-center justify-end gap-1.5 text-xs">
              {avatar?.(row.id)}
              {row.href ? (
                <a href={withAsOf(row.href, asOf)} className="truncate hover:underline">
                  {row.label}
                </a>
              ) : (
                <span className="truncate">{row.label}</span>
              )}
            </div>
          </foreignObject>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit -p tsconfig.json`
Expected: exit 0. If it complains about `findLast`/`toSorted`, the tsconfig `lib` already covers ES2023 (they are used in `timeline.ts`); otherwise fix the import paths, not the code.

- [ ] **Step 3: Run the whole suite**

Run: `bun test`
Expected: all previous tests plus the 15 new ones pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/SliceChart.tsx
git commit -m "feat: SliceChart component"
```

---

### Task 5: Wire the chart into the hypothesis and company pages, verify in the browser

**Files:**
- Modify: `src/components/Hypotheses.tsx` (inside the `shown.map` section, before the `drawn.map` strip rows)
- Modify: `src/components/Company.tsx` (before the `mt-8` div of strip rows)

**Interfaces:**
- Consumes: `SliceChart` (Task 4), `companyRows` and `hypothesisRows` (Task 3), `CompanyAvatar` from `./shared`, `useAsOf` from `./asof`.

- [ ] **Step 1: Add the chart to the single-hypothesis page**

In `src/components/Hypotheses.tsx`:

Add imports:

```tsx
import { SliceChart } from "./SliceChart";
import { companyRows } from "./sliceRows";
```

Change the `useAsOf` line to also take `setAsOf`:

```tsx
const { asOf, setAsOf, today } = useAsOf();
```

Inside the `shown.map((ph) => { ... })` JSX, directly after the `{!hypothesisId && (<h2 ...>)}` block and before `{drawn.map(...)}`, add:

```tsx
{hypothesisId && (
  <div className="mb-8">
    <SliceChart
      rows={companyRows(companies, ph.id)}
      asOf={asOf}
      today={today}
      onPickDate={setAsOf}
      avatar={(rowId) => {
        const c = companies.find((x) => x.id === rowId);
        return c ? <CompanyAvatar company={c} /> : null;
      }}
    />
  </div>
)}
```

`CompanyAvatar` and `companies` are already imported/in scope in that file.

- [ ] **Step 2: Add the chart to the company page**

In `src/components/Company.tsx`:

Add imports:

```tsx
import { SliceChart } from "./SliceChart";
import { hypothesisRows } from "./sliceRows";
```

Change the `useAsOf` line:

```tsx
const { asOf, setAsOf, today } = useAsOf();
```

Directly before `<div className="mt-8">` (the strip rows), add:

```tsx
<div className="mt-8">
  <SliceChart rows={hypothesisRows(full)} asOf={asOf} today={today} onPickDate={setAsOf} />
</div>
```

- [ ] **Step 3: Typecheck and run tests**

Run: `bunx tsc --noEmit -p tsconfig.json` then `bun test`
Expected: exit 0, all tests pass.

- [ ] **Step 4: Verify in the browser**

Start the dev server with the `dev` configuration in `.claude/launch.json` (port 3000) using the preview tools, then check each of the following and take a screenshot as proof:

1. `/hypotheses/moat`: the chart shows four slices dated Jan 12, Mar 1, Jun 4 and Sep 25 2026, five columns with company avatars and names along the front slice's base, markers with halos, evidence dots stacked up and down, trails between slices, and the Sep 25 slice emphasized (cursor on today).
2. Click the Mar 1 panel: the header scrubber moves to Mar 1, the Mar 1 slice becomes emphasized and the others dim, the page turns into its rewound state.
3. `/c/exa`: the chart shows four columns labeled by hypothesis short name (Moat, Adoption, ...), no avatars.
4. A column with no assessment on a given day (Brave on moat has 3 assessments; Tavily on differentiation has 3) shows a hollow marker on the day it was carried.
5. Console has no errors (`read_console_messages` with onlyErrors).
6. Phone width (`resize_window` preset mobile): the chart keeps its 640px minimum and the page pans horizontally without the rest of the layout breaking. Reset to desktop afterwards.

If any of the above fails, fix the source and repeat from step 3.

- [ ] **Step 5: Commit**

```bash
git add src/components/Hypotheses.tsx src/components/Company.tsx
git commit -m "feat: show the slice chart on hypothesis and company pages"
```

---

## Self-review notes

- Spec coverage: §1 data layer → Task 1 (lean, sliceDays, buildSlices with fresh/carried/absent, windowing, cap, cursorSlice); adapters → Task 3; §2 projection and `bounds` → Task 2; §3 component (panels, zero line, date label, stacks, overflow, halo, fresh/hollow markers, trails dimmed behind the next panel, flip coloring, cursor emphasis, click to pick, marker links, column labels with avatars, legend, min-width wrapper, empty state) → Task 4; §4 integration and browser verification → Task 5; tests listed in the spec → Tasks 1 to 3.
- Type consistency: `SliceRow`, `Marker`, `Slice`, `SliceCell`, `StackKey` are defined in Task 1 and used unchanged in Tasks 3 and 4; `project`, `columnU`, `leanV`, `sliceW`, `planeWidth`, `panelCorners`, `bounds`, `toPoints`, `ISO`, `Point` are defined in Task 2 and used unchanged in Task 4; `companyRows`/`hypothesisRows` from Task 3 are used unchanged in Task 5.
