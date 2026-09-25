import { useMemo } from "react";
import { lensesOf, timeDomain } from "@/domain/timeline";
import type { Company, Hypothesis, Run } from "@/domain/types";
import { useAsOf } from "./asof";
import { ConfidenceStrip } from "./ConfidenceStrip";
import { usePortfolio } from "./usePortfolio";
import { companyPath, hypothesisPath } from "./routes";
import { formatConfidence, STATUS, StatusDot, withAsOf } from "./shared";

/** Home: every company against every lens, at the cursor. One cell is one hypothesis. */
export function Matrix({ activeRuns }: { activeRuns: Run[] }) {
  const { companies, companiesAsOf, loaded } = usePortfolio();
  const { asOf, today } = useAsOf();
  const lenses = useMemo(() => lensesOf(companies), [companies]);
  const domain = useMemo(() => timeDomain(companies, today), [companies, today]);
  const busy = new Set(activeRuns.map((r) => r.hypothesisId ?? r.companyId));

  if (!loaded) return null;

  return (
    <section className="min-w-0">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Portfolio</h1>
          <p className="text-muted-foreground">
            Confidence in each lens, per company. Drag the timeline to see what was known when.
          </p>
        </div>
        <div className="-mx-6 overflow-x-auto px-6">
          <div
            className="grid border-b"
            style={{ gridTemplateColumns: `minmax(140px, 180px) repeat(${lenses.length}, minmax(150px, 1fr))`, minWidth: 140 + 150 * lenses.length }}
          >
            <div />
            {lenses.map((l) => (
              <div key={l.key} className="border-b px-3 pb-2 text-xs leading-snug font-medium text-muted-foreground">
                {l.statement}
              </div>
            ))}
            {companiesAsOf.map((view, i) => (
              <Row key={view.id} view={view} full={companies[i]!} lenses={lenses} domain={domain} asOf={asOf} today={today} busy={busy} />
            ))}
          </div>
        </div>
    </section>
  );
}

function Row({
  view,
  full,
  lenses,
  domain,
  asOf,
  today,
  busy,
}: {
  view: Company;
  full: Company;
  lenses: { key: string }[];
  domain: [string, string];
  asOf?: string;
  today: string;
  busy: Set<string>;
}) {
  const assessed = view.hypotheses.filter((h) => h.confidence !== undefined);
  const average = assessed.length ? Math.round(assessed.reduce((n, h) => n + h.confidence!, 0) / assessed.length) : undefined;

  return (
    <>
      <a href={withAsOf(companyPath(view.id), asOf)} className="flex flex-col justify-center gap-0.5 border-t py-3 pr-3 hover:bg-muted/50">
        <span className="font-medium">{view.name}</span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {average === undefined ? `${assessed.length ? "" : "untested"}` : `avg ${average}%`}
        </span>
      </a>
      {lenses.map((l) => {
        const h = view.hypotheses.find((x) => x.lens === l.key);
        const fullH = full.hypotheses.find((x) => x.lens === l.key);
        if (!h || !fullH) return <div key={l.key} className="border-t" />;
        return <Cell key={l.key} companyId={view.id} hypothesis={h} full={fullH} domain={domain} asOf={asOf} today={today} busy={busy.has(h.id) || busy.has(view.id)} />;
      })}
    </>
  );
}

function Cell({
  companyId,
  hypothesis: h,
  full,
  domain,
  asOf,
  today,
  busy,
}: {
  companyId: string;
  hypothesis: Hypothesis;
  full: Hypothesis;
  domain: [string, string];
  asOf?: string;
  today: string;
  busy: boolean;
}) {
  const untested = h.status === "untested";
  return (
    <a href={withAsOf(hypothesisPath(companyId, h.id), asOf)} className={`flex flex-col gap-1.5 border-t border-l px-3 py-3 hover:bg-muted/50 ${untested ? "bg-muted/30" : ""}`}>
      <span className="flex items-center gap-2">
        <span className={`font-mono text-xl leading-none tabular-nums ${untested ? "text-muted-foreground" : ""}`}>{formatConfidence(h.confidence)}</span>
        <StatusDot status={h.status} />
        <span className="text-xs text-muted-foreground">{h.status}</span>
        {busy && <span className="ml-auto size-2 animate-pulse rounded-full bg-sky-500" title="Research running" />}
      </span>
      <ConfidenceStrip hypothesis={full} domain={domain} asOf={asOf} today={today} size="mini" />
      <span className="sr-only">{STATUS[h.status].badge}</span>
    </a>
  );
}
