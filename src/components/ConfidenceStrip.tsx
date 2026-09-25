import { memo } from "react";
import { evidenceTicks, scale, stepSegments, type Domain } from "@/domain/timeline";
import type { Hypothesis } from "@/domain/types";
import { DIRECTION, formatDate, STATUS } from "./shared";
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
  row: { height: 72, top: 8, bottom: 22, dot: 4 },
  full: { height: 160, top: 12, bottom: 44, dot: 5 },
};
const MINI_WIDTH = 120;
const TICK_HEIGHT = 8;

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
  const cursorX = s.x(asOf ?? today);
  const showCursor = size !== "mini";
  const pickable = size === "full" && !!onPickDate;

  return (
    <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={`Confidence over time: ${h.statement}`}>
      {/* baseline */}
      <line x1={0} x2={width} y1={baseline} y2={baseline} className="stroke-border" strokeDasharray={h.history.length ? undefined : "2 3"} />

      {/* evidence on the baseline, where it became knowable */}
      {ticks.map((t) => (
        <line key={t.id} x1={s.x(t.at)} x2={s.x(t.at)} y1={baseline + 2} y2={baseline + 2 + TICK_HEIGHT} className={DIRECTION[t.type ?? "unclassified"].stroke} strokeWidth={1}>
          <title>{formatDate(t.at)}</title>
        </line>
      ))}
      {earlier.length > 0 && (
        <text x={0} y={baseline + TICK_HEIGHT + 12} className="fill-muted-foreground text-[10px]">
          +{earlier.length} earlier
        </text>
      )}

      {/* confidence: holds from each assessment to the next */}
      {segments.map((seg, i) => {
        const x0 = s.x(seg.from);
        const x1 = s.x(seg.to);
        const prev = segments[i - 1];
        return (
          <g key={seg.asOf} className={STATUS[seg.status].stroke}>
            {prev && <line x1={x0} x2={x0} y1={y(prev.confidence)} y2={y(seg.confidence)} className="stroke-border" strokeWidth={1} />}
            <line x1={x0} x2={x1} y1={y(seg.confidence)} y2={y(seg.confidence)} strokeWidth={2} strokeLinecap="round" />
          </g>
        );
      })}
      {segments.map((seg) => (
        <g key={seg.asOf} onClick={pickable ? () => onPickDate!(seg.asOf) : undefined} className={pickable ? "cursor-pointer" : undefined}>
          {pickable && <circle cx={s.x(seg.from)} cy={y(seg.confidence)} r={12} className="fill-transparent" />}
          <circle cx={s.x(seg.from)} cy={y(seg.confidence)} r={dot + 1.5} className="fill-background" />
          <circle cx={s.x(seg.from)} cy={y(seg.confidence)} r={dot} className={STATUS[seg.status].fill} />
          <title>
            {formatDate(seg.from)}: {seg.confidence}%, {seg.status}
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
