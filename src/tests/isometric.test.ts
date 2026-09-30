import { test, expect } from "bun:test";
import { bounds, columnU, ISO, leanV, panelCorners, planeWidth, project, sliceW, toPoints } from "../domain/isometric";

const COS30 = Math.sqrt(3) / 2;

test("project maps the origin to the origin and each axis to its isometric direction", () => {
  expect(project(0, 0, 0)).toEqual({ x: 0, y: 0 });
  const u = project(1, 0, 0);
  expect(u.x).toBeCloseTo(COS30);
  expect(u.y).toBeCloseTo(0.5);
  const v = project(0, 1, 0);
  expect(v.x).toBeCloseTo(0);
  expect(v.y).toBeCloseTo(-1);
  const w = project(0, 0, 1);
  expect(w.x).toBeCloseTo(COS30);
  expect(w.y).toBeCloseTo(-0.5);
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

test("panelCorners is the projected rectangle of a slice, top-left first", () => {
  const [tl, tr, br, bl] = panelCorners(1, 0);
  const H = ISO.planeHeight / 2;
  const W = planeWidth(1);
  expect(tl).toEqual(project(0, H, 0));
  expect(tr).toEqual(project(W, H, 0));
  expect(br).toEqual(project(W, -H, 0));
  expect(bl).toEqual(project(0, -H, 0));
  expect(tr!.x).toBeGreaterThan(tl!.x);
});

test("later slices sit up and to the right of earlier ones", () => {
  const [a] = panelCorners(3, 0);
  const [b] = panelCorners(3, 1);
  expect(b!.x).toBeGreaterThan(a!.x);
  expect(b!.y).toBeLessThan(a!.y);
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
