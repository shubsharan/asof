import { memo } from "react";
import { binTicks, evidenceTicks, scale, stepSegments, type Bin, type Domain } from "@/domain/timeline";
import type { Hypothesis } from "@/domain/types";
import { DIRECTION, formatDate } from "./shared";
import { useWidth } from "./useWidth";

/**
 * The one chart in AsOf: confidence in a hypothesis over time. Each assessment is a dot, confidence
 * holds as a line until the next one, and evidence sits on the baseline where it became knowable.
 * The cursor is the as-of date; everything to its right is dimmed because it wasn't known yet.
 *
 * Pass the hypothesis with its full history (not the rewound one) so the future can be drawn.
 * Sizes: `mini` (fixed 120px, for a matrix cell), `row` (full width), `full` (full width, tall,
 * points clickable and dated).
 */
export type StripSize = "mini" | "row" | "full";

const SIZES: Record<StripSize, { height: number; top: number; bottom: number; dot: number }> = {
  mini: { height: 28, top: 3, bottom: 3, dot: 2.5 },
  row: { height: 84, top: 8, bottom: 34, dot: 4 },
  full: { height: 172, top: 12, bottom: 56, dot: 5 },
};
const MINI_WIDTH = 120;
/** Evidence is binned into bars this wide; the bar grows `BAR_PX_PER_ITEM` per item up to the strip's bottom margin. */
const BIN_PX = 6;
const BAR_PX_PER_ITEM = 4;
const BAR_MIN_PX = 3;

type Props = {
  hypothesis: Hypothesis;
  domain: Domain;
  /** The cursor; undefined means today. */
  asOf?: string;
  today: string;
  size: StripSize;
  onPickDate?: (asOf: string) => void;
};

export const ConfidenceStrip = memo(function ConfidenceStrip({ hypothesis, domain, asOf, today, size, onPickDate }: Props) {
  const [ref, measured] = useWidth<HTMLDivElement>();
  const width = size === "mini" ? MINI_WIDTH : measured;
  const { height, top, bottom, dot } = SIZES[size];

  return (
    <div ref={ref} className={size === "mini" ? "w-[120px]" : "w-full min-w-0"} style={{ height }}>
      {width > 0 && (
        <Chart hypothesis={hypothesis} domain={domain} asOf={asOf} today={today} size={size} onPickDate={onPickDate} width={width} height={height} top={top} bottom={bottom} dot={dot} />
      )}
    </div>
  );
});

function Chart({
  hypothesis: h,
  domain,
  asOf,
  today,
  size,
  onPickDate,
  width,
  height,
  top,
  bottom,
  dot,
}: Props & { width: number; height: number; top: number; bottom: number; dot: number }) {
  const s = scale(domain, width);
  const baseline = height - bottom;
  const y = (confidence: number) => baseline - (confidence / 100) * (baseline - top);
  const segments = stepSegments(h.history, domain);
  const { ticks, earlier } = size === "mini" ? { ticks: [], earlier: [] } : evidenceTicks(h.evidence, domain);
  const bins = binTicks(ticks, domain, width, BIN_PX);
  const barMax = bottom - 14;
  const cursorX = s.x(asOf ?? today);
  const showCursor = size !== "mini";
  const pickable = size === "full" && !!onPickDate;

  return (
    <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={`Confidence over time: ${h.statement}`}>
      {/* baseline */}
      <line x1={0} x2={width} y1={baseline} y2={baseline} className="stroke-border" strokeDasharray={h.history.length ? undefined : "2 3"} />

      {/* evidence under the baseline, where it became knowable: one bar per few days, stacked by direction */}
      {bins.map((b) => (
        <EvidenceBar key={b.x} bin={b} y={baseline + 2} max={barMax} />
      ))}
      {earlier.length > 0 && (
        <text x={0} y={height - 2} className="fill-muted-foreground text-[10px]">
          +{earlier.length} earlier
        </text>
      )}

      {/* confidence: holds from each assessment to the next */}
      {segments.map((seg, i) => {
        const x0 = s.x(seg.from);
        const x1 = s.x(seg.to);
        const prev = segments[i - 1];
        return (
          <g key={seg.asOf} className={DIRECTION[seg.verdict].stroke}>
            {prev && <line x1={x0} x2={x0} y1={y(prev.confidence)} y2={y(seg.confidence)} className="stroke-border" strokeWidth={1} />}
            <line x1={x0} x2={x1} y1={y(seg.confidence)} y2={y(seg.confidence)} strokeWidth={2} strokeLinecap="round" />
          </g>
        );
      })}
      {segments.map((seg) => (
        <g key={seg.asOf} onClick={pickable ? () => onPickDate!(seg.asOf) : undefined} className={pickable ? "cursor-pointer" : undefined}>
          {pickable && <circle cx={s.x(seg.from)} cy={y(seg.confidence)} r={12} className="fill-transparent" />}
          <circle cx={s.x(seg.from)} cy={y(seg.confidence)} r={dot + 1.5} className="fill-background" />
          <circle cx={s.x(seg.from)} cy={y(seg.confidence)} r={dot} className={DIRECTION[seg.verdict].fill} />
          <title>
            {formatDate(seg.from)}: {seg.verdict}, {seg.confidence}% confident
          </title>
        </g>
      ))}
      {size === "full" &&
        segments.map((seg) => (
          <text key={seg.asOf} x={s.x(seg.from)} y={y(seg.confidence) - dot - 6} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">
            {seg.confidence}%
          </text>
        ))}

      {/* what came after the cursor wasn't known yet */}
      {cursorX < width && <rect x={cursorX} y={0} width={width - cursorX} height={height} className="fill-background" opacity={0.7} />}
      {showCursor && <line x1={cursorX} x2={cursorX} y1={0} y2={height} className="stroke-foreground" strokeWidth={1} />}
    </svg>
  );
}

/** Supports on top, then contradicts, neutral and unclassified; the whole bar caps at `max` so a burst stays readable. */
function EvidenceBar({ bin, y, max }: { bin: Bin; y: number; max: number }) {
  const total = bin.supports + bin.contradicts + bin.neutral + bin.unclassified;
  const unit = Math.max(BAR_MIN_PX / total, Math.min(BAR_PX_PER_ITEM, max / total));
  const parts: [type: keyof typeof DIRECTION, count: number][] = [
    ["supports", bin.supports],
    ["contradicts", bin.contradicts],
    ["neutral", bin.neutral],
    ["unclassified", bin.unclassified],
  ];
  const label = parts
    .filter(([, n]) => n)
    .map(([t, n]) => `${n} ${t}`)
    .join(", ");
  let top = y;
  return (
    <g>
      <title>
        {bin.from === bin.to ? formatDate(bin.from) : `${formatDate(bin.from)} – ${formatDate(bin.to)}`}: {label}
      </title>
      {parts.map(([type, n]) => {
        if (!n) return null;
        const h = n * unit;
        const el = <rect key={type} x={bin.x + 1} y={top} width={BIN_PX - 2} height={h} className={DIRECTION[type].fill} />;
        top += h;
        return el;
      })}
    </g>
  );
}
