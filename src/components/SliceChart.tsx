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

/** Row labels along the base of the front slice, each below and to the right of its column. */
function ColumnLabels({ rows, k, asOf, avatar }: { rows: SliceRow[]; k: number; asOf?: string; avatar?: (rowId: string) => ReactNode }) {
  return (
    <>
      {rows.map((row, i) => {
        const p = project(columnU(i), -ISO.planeHeight / 2, sliceW(k));
        return (
          <foreignObject key={row.id} x={p.x + 8} y={p.y + 2} width={LABEL_WIDTH} height={LABEL_HEIGHT}>
            <div className="flex h-full items-center justify-start gap-1.5 text-xs">
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
