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
export const PAD = { top: 24, right: 160, bottom: 40, left: 16 };

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
