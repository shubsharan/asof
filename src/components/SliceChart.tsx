import { useMemo, useState, type ReactNode } from "react";
import { bounds, columnU, ISO, leanV, panelCorners, planeWidth, project, sliceW, toPoints, type Point } from "@/domain/isometric";
import { buildSlices, cursorSlice, sliceDays, type Marker, type Slice, type SliceCell, type SliceRow, type StackKey } from "@/domain/slices";
import { DIRECTION, formatDate } from "./shared";

/**
 * Hypotheses over time as a stack of isometric slices, one per assessment day, oldest bottom-left and
 * newest top-right. Each row has a column; its assessment sits at its lean (signed confidence: up
 * supports, down contradicts) and the evidence that became knowable since the previous slice stacks
 * around the zero line. Trails join a row's markers across slices. The slice on the cursor is
 * emphasized; clicking a slice moves the cursor.
 *
 * The chart carries no text: `SliceLegend` explains the marks and the row legend under the chart names
 * the columns in their left-to-right order. Hovering a row in either place singles out its column.
 * Scales to its container's width, capped in height. Renders nothing until a row has been assessed.
 * Draws oldest first so the newest slice is in front.
 */
type Props = {
  rows: SliceRow[];
  /** The cursor; undefined means today. */
  asOf?: string;
  today: string;
  onPickDate: (day: string) => void;
  avatar?: (rowId: string) => ReactNode;
};

export function SliceChart({ rows, asOf, today, onPickDate, avatar }: Props) {
  const [focus, setFocus] = useState<string>();
  const days = useMemo(() => sliceDays(rows), [rows]);
  const slices = useMemo(() => buildSlices(rows, days), [rows, days]);
  if (days.length === 0) return null;

  const cursor = cursorSlice(days, asOf, today);
  const box = bounds(rows.length, days.length);

  return (
    <div>
      <svg
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        className="mx-auto block h-auto max-h-[360px] w-full"
        role="img"
        aria-label={`${rows.length} rows over ${days.length} assessment days`}
      >
        {slices.map((slice, k) => (
          <g key={slice.day}>
            <Panel slice={slice} k={k} rows={rows} cursor={cursor} focus={focus} onFocus={setFocus} onPick={onPickDate} />
            {k < slices.length - 1 && <Trails from={slice} to={slices[k + 1]!} k={k} rows={rows} cursor={cursor} focus={focus} />}
          </g>
        ))}
      </svg>
      <RowLegend rows={rows} avatar={avatar} focus={focus} onFocus={setFocus} />
    </div>
  );
}

/** Neutral and unclassified dots along the zero line before the rest collapses into "+N", so they stay inside the column. */
const ALONG_CAP = 10;

/** Slices before the cursor are dimmed; slices after it weren't known yet, so they're dimmer. */
const dimClass = (day: string, cursor: string | undefined) => (cursor === undefined || day > cursor ? "opacity-25" : day < cursor ? "opacity-60" : "");

/** Every row but the hovered one fades. */
const dim = (focus: string | undefined, id: string) => `transition-opacity ${focus && focus !== id ? "opacity-15" : ""}`;

function Panel({
  slice,
  k,
  rows,
  cursor,
  focus,
  onFocus,
  onPick,
}: {
  slice: Slice;
  k: number;
  rows: SliceRow[];
  cursor: string | undefined;
  focus?: string;
  onFocus: (rowId?: string) => void;
  onPick: (day: string) => void;
}) {
  const w = sliceW(k);
  const [z0, z1] = [project(0, 0, w), project(planeWidth(rows.length), 0, w)];
  const active = slice.day === cursor;
  return (
    <g className={dimClass(slice.day, cursor) || undefined}>
      <polygon
        points={toPoints(panelCorners(rows.length, k))}
        className={`cursor-pointer fill-foreground/[0.04] ${active ? "stroke-foreground" : "stroke-border"}`}
        strokeWidth={active ? 1.5 : 1}
        onClick={() => onPick(slice.day)}
      >
        <title>{`${formatDate(slice.day)}. Click to set the cursor here.`}</title>
      </polygon>
      <line x1={z0.x} y1={z0.y} x2={z1.x} y2={z1.y} className="pointer-events-none stroke-border" strokeDasharray="3 3" />
      {slice.cells.map((cell, i) => (
        <g key={cell.rowId} className={dim(focus, cell.rowId)} onMouseEnter={() => onFocus(cell.rowId)} onMouseLeave={() => onFocus(undefined)}>
          <Column cell={cell} row={rows[i]!} u={columnU(i)} w={w} />
        </g>
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

function Column({ cell, row, u, w }: { cell: SliceCell; row: SliceRow; u: number; w: number }) {
  const { supports, contradicts, neutral, unclassified } = cell.evidence;
  const dots: { p: Point; key: StackKey; title: string; id: string }[] = [];
  supports.shown.forEach((e, j) => dots.push({ p: project(u, (j + 1) * ISO.dotPitch, w), key: "supports", title: e.title, id: e.id }));
  contradicts.shown.forEach((e, j) => dots.push({ p: project(u, -(j + 1) * ISO.dotPitch, w), key: "contradicts", title: e.title, id: e.id }));
  const alongAll = [...neutral.shown.map((e) => ({ e, key: "neutral" as StackKey })), ...unclassified.shown.map((e) => ({ e, key: "unclassified" as StackKey }))];
  const alongShown = alongAll.slice(0, ALONG_CAP);
  const alongOverflow = alongAll.length - alongShown.length + neutral.overflow + unclassified.overflow;
  alongShown.forEach(({ e, key }, j) => dots.push({ p: project(u + (j - (alongShown.length - 1) / 2) * ISO.dotPitch, 0, w), key, title: e.title, id: e.id }));

  const upOverflow = supports.overflow > 0 && project(u, (supports.shown.length + 1) * ISO.dotPitch + 8, w);
  const downOverflow = contradicts.overflow > 0 && project(u, -((contradicts.shown.length + 1) * ISO.dotPitch + 8), w);
  const alongOverflowPoint = alongOverflow > 0 && project(u - ((alongShown.length + 1) / 2) * ISO.dotPitch - 6, 0, w);

  return (
    <g>
      {dots.map((d) => (
        <circle key={d.id} cx={d.p.x} cy={d.p.y} r={ISO.dotRadius} className={`pointer-events-none ${STACK_FILL[d.key]}`}>
          <title>{d.title}</title>
        </circle>
      ))}
      {upOverflow && (
        <text x={upOverflow.x} y={upOverflow.y} textAnchor="middle" className="pointer-events-none fill-muted-foreground font-mono text-[9px]">
          +{supports.overflow}
        </text>
      )}
      {downOverflow && (
        <text x={downOverflow.x} y={downOverflow.y + 6} textAnchor="middle" className="pointer-events-none fill-muted-foreground font-mono text-[9px]">
          +{contradicts.overflow}
        </text>
      )}
      {alongOverflowPoint && (
        <text x={alongOverflowPoint.x} y={alongOverflowPoint.y} textAnchor="start" dominantBaseline="middle" className="pointer-events-none fill-muted-foreground font-mono text-[9px]">
          +{alongOverflow}
        </text>
      )}
      {cell.marker && <MarkerDot marker={cell.marker} row={row} p={project(u, leanV(cell.marker.lean), w)} />}
    </g>
  );
}

function MarkerDot({ marker: m, row, p }: { marker: Marker; row: SliceRow; p: Point }) {
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
  const href = row.href && `${row.href}${row.href.includes("?") ? "&" : "?"}asOf=${encodeURIComponent(m.asOf)}${m.assessmentId === undefined ? "" : `&assessmentId=${m.assessmentId}`}`;
  return href ? <a href={href}>{dot}</a> : dot;
}

function Trails({ from, to, k, rows, cursor, focus }: { from: Slice; to: Slice; k: number; rows: SliceRow[]; cursor: string | undefined; focus?: string }) {
  return (
    <g className={dimClass(to.day, cursor) || undefined}>
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
            className={`${flipped ? DIRECTION[b.verdict].stroke : "stroke-muted-foreground/40"} ${dim(focus, row.id)}`}
            strokeWidth={flipped ? 2 : 1.25}
          />
        );
      })}
    </g>
  );
}

/** Names the columns in their left-to-right order; hovering one singles out its column in the chart. */
function RowLegend({ rows, avatar, focus, onFocus }: { rows: SliceRow[]; avatar?: (rowId: string) => ReactNode; focus?: string; onFocus: (rowId?: string) => void }) {
  return (
    <ul className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs">
      {rows.map((row) => {
        const label = (
          <>
            {avatar?.(row.id)}
            <span>{row.label}</span>
          </>
        );
        const cls = `flex items-center gap-1.5 transition-colors ${focus && focus !== row.id ? "text-muted-foreground" : ""}`;
        const hover = { onMouseEnter: () => onFocus(row.id), onMouseLeave: () => onFocus(undefined), onFocus: () => onFocus(row.id), onBlur: () => onFocus(undefined) };
        return (
          <li key={row.id}>
            {row.href ? (
              <a href={row.href} className={`${cls} underline-offset-2 hover:underline`} {...hover}>
                {label}
              </a>
            ) : (
              <span className={cls} {...hover}>
                {label}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What the marks mean: colour is the verdict, fill is freshness, the halo is confidence. */
export function SliceLegend({ reconstructed = false }: { reconstructed?: boolean }) {
  const swatch = (children: ReactNode) => (
    <svg viewBox="-8 -8 16 16" className="size-4 shrink-0 overflow-visible" aria-hidden>
      {children}
    </svg>
  );
  const verdicts = (["supports", "neutral", "contradicts"] as const).map((d) => [d, swatch(<circle r={4} className={DIRECTION[d].fill} />)] as const);
  const marks = [
    ["assessed", swatch(<circle r={4} className="fill-foreground/70" />)],
    ["carried", swatch(<circle r={3.5} className="fill-background stroke-foreground/70" strokeWidth={1.5} />)],
    ["confidence", swatch(<><circle r={7.5} className="fill-foreground/15" /><circle r={3} className="fill-foreground/70" /></>)],
    [reconstructed ? "sources by publication date" : "newly collected evidence", swatch(<>{[-5, 0, 5].map((y) => <circle key={y} cy={y} r={1.5} className="fill-foreground/50" />)}</>)],
  ] as const;
  const group = (items: readonly (readonly [string, ReactNode])[]) => (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map(([label, icon]) => (
        <li key={label} className="flex items-center gap-1">
          {icon}
          {label}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
      {group(verdicts)}
      {group(marks)}
    </div>
  );
}
