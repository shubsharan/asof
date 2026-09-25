import type { Domain } from "@/domain/timeline";
import type { Hypothesis } from "@/domain/types";
import { ConfidenceStrip } from "./ConfidenceStrip";
import { DIRECTION, formatConfidence, StatusBadge, withAsOf } from "./shared";

/**
 * A titled, full-width strip: one hypothesis on the shared time axis, with its reading at the cursor
 * above and evidence counts below. A company page titles rows by lens; a lens page titles them by company.
 * The title sits above the strip, not beside it, so every strip spans the scrubber's x-range.
 */
export function StripRow({
  title,
  href,
  hypothesis: h,
  full,
  domain,
  asOf,
  today,
}: {
  title: string;
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
  const moved = asOf && (full.confidence !== h.confidence || full.status !== h.status);
  const after = full.evidence.length - h.evidence.length;

  return (
    <a href={withAsOf(href, asOf)} className="group block border-t py-5 hover:bg-muted/30">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium group-hover:underline">{title}</span>
        <span className="ml-auto flex items-baseline gap-2 font-mono tabular-nums">
          <span className="text-xl">{formatConfidence(h.confidence)}</span>
          <StatusBadge status={h.status} />
          {moved && (
            <span className="text-xs text-muted-foreground">
              → {formatConfidence(full.confidence)} {full.status} today
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
        <span>{count("neutral") + count("unclassified")} other</span>
        <span>· {h.history.length} assessments</span>
        {asOf && after > 0 && <span>· +{after} evidence after this date</span>}
      </p>
    </a>
  );
}
