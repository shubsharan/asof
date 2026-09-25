import { lastMove } from "@/domain/changes";
import type { Domain } from "@/domain/timeline";
import type { Hypothesis } from "@/domain/types";
import { ConfidenceStrip } from "./ConfidenceStrip";
import { DeltaChip, DIRECTION, formatConfidence, VerdictBadge, withAsOf } from "./shared";

/**
 * A titled, full-width strip: one hypothesis on the shared time axis, with its reading at the cursor
 * (and the move its last assessment made) above, and evidence counts below. A company page titles
 * rows by lens; a lens page titles them by company. The title sits above the strip, not beside it,
 * so every strip spans the scrubber's x-range.
 */
export function StripRow({
  title,
  avatar,
  href,
  hypothesis: h,
  full,
  domain,
  asOf,
  today,
}: {
  title: string;
  /** Shown before the title, e.g. the company's logo on a hypothesis page. */
  avatar?: React.ReactNode;
  href: string;
  /** As of the cursor. */
  hypothesis: Hypothesis;
  /** With everything known today, so the strip can draw what came after. */
  full: Hypothesis;
  domain: Domain;
  asOf?: string;
  today: string;
}) {
  const count = (type?: string) => h.evidence.filter((e) => (e.type ?? "unclassified") === type).length;
  const moved = asOf && (full.confidence !== h.confidence || full.verdict !== h.verdict);
  const after = full.evidence.length - h.evidence.length;
  const attention = h.verdict === "contradicts";

  return (
    <a href={withAsOf(href, asOf)} className={`group block border-t py-5 pl-3 hover:bg-muted/30 ${attention ? "border-l-2 border-l-red-500" : "border-l-2 border-l-transparent"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 font-medium">
          {avatar}
          <span className="group-hover:underline">{title}</span>
        </span>
        <span className="flex items-baseline gap-2 font-mono tabular-nums">
          <VerdictBadge verdict={h.verdict} />
          <span className="text-xl">{formatConfidence(h.confidence)}</span>
          <DeltaChip move={lastMove(h)} />
          {moved && (
            <span className="text-xs text-muted-foreground">
              → {full.verdict} {formatConfidence(full.confidence)} today
            </span>
          )}
        </span>
      </div>
      <div className="mt-3">
        <ConfidenceStrip hypothesis={full} domain={domain} asOf={asOf} today={today} size="row" />
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground tabular-nums">
        <span className={DIRECTION.supports.text}>{count("supports")} supports</span>
        <span className={DIRECTION.contradicts.text}>{count("contradicts")} contradicts</span>
        <span className={DIRECTION.neutral.text}>{count("neutral")} neutral</span>
        {count("unclassified") > 0 && <span>{count("unclassified")} unclassified</span>}
        <span>· {h.history.length} assessments</span>
        {asOf && after > 0 && <span>· +{after} evidence after this date</span>}
      </p>
    </a>
  );
}
