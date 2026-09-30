import { researchSummary } from "@/domain/research";
import type { Hypothesis } from "@/domain/types";
import { VerdictBadge, withAsOf } from "./shared";

/**
 * A linked analyst conclusion with its recorded evidence and pending proposal count.
 */
export function StripRow({
  title,
  avatar,
  href,
  hypothesis: h,
  full,
  asOf,
}: {
  title: string;
  /** Shown before the title, e.g. the company's logo on a hypothesis page. */
  avatar?: React.ReactNode;
  href: string;
  /** As of the cursor. */
  hypothesis: Hypothesis;
  /** With everything known today, so the strip can draw what came after. */
  full: Hypothesis;
  asOf?: string;
}) {
  const latest = h.history.at(-1);

  return (
    <a href={withAsOf(href, asOf)} className="group block border-t px-3 py-5 hover:bg-muted/30">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 font-medium">
          {avatar}
          <span className="group-hover:underline">{title}</span>
        </span>
        <span className="flex items-center gap-2">
          <VerdictBadge verdict={h.verdict} />

        </span>
      </div>
      {latest && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{researchSummary(latest.reasoning).replace(/\*\*/g, "")}</p>}
    </a>
  );
}
