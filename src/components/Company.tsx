import { useMemo } from "react";
import { timeDomain } from "@/domain/timeline";
import { Button } from "@/components/ui/button";
import { useAsOf } from "./asof";
import { usePortfolio } from "./usePortfolio";
import { hypothesisPath } from "./routes";
import { openResearch, useCompany } from "./shared";
import { StripRow } from "./StripRow";

/** One row of the matrix, expanded: every lens as a full-width strip on the shared time axis. */
export function Company({ id }: { id: string }) {
  const { company: view, today: full } = useCompany(id);
  const { companies } = usePortfolio();
  const { asOf, today } = useAsOf();
  const domain = useMemo(() => timeDomain(companies, today), [companies, today]);
  if (!view || !full) return null;

  const assessed = view.hypotheses.filter((h) => h.confidence !== undefined);
  const average = assessed.length ? Math.round(assessed.reduce((n, h) => n + h.confidence!, 0) / assessed.length) : undefined;
  const known = view.hypotheses.reduce((n, h) => n + h.evidence.length, 0);

  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{view.name}</h1>
          <p className="text-muted-foreground">{view.description}</p>
          <p className="mt-2 font-mono text-xs text-muted-foreground tabular-nums">
            {average === undefined ? "Untested" : `Average confidence ${average}%`} · {assessed.length} of {view.hypotheses.length} lenses assessed · {known} evidence known
          </p>
        </div>
        {!asOf && (
          <Button variant="outline" onClick={() => openResearch({ kind: "search", companyId: id })}>
            Run research
          </Button>
        )}
      </div>

      <div className="mt-8">
        {view.hypotheses.map((h) => (
          <StripRow
            key={h.id}
            title={h.statement}
            href={hypothesisPath(id, h.id)}
            hypothesis={h}
            full={full.hypotheses.find((x) => x.id === h.id)!}
            domain={domain}
            asOf={asOf}
            today={today}
          />
        ))}
      </div>
    </>
  );
}
