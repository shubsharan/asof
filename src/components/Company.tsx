import { useMemo } from "react";
import { changedThisWeek } from "@/domain/changes";
import { timeDomain } from "@/domain/timeline";
import { Button } from "@/components/ui/button";
import { useAsOf } from "./asof";
import { CompanyCompare } from "./Compare";
import { usePortfolio } from "./usePortfolio";
import { companyHypothesisPath } from "./routes";
import { openResearch, useCompany } from "./shared";
import { StripRow } from "./StripRow";

/**
 * One row of the matrix, expanded: every lens as a full-width strip on the shared time axis.
 * The header says what moved this week; when rewound, a table compares that day with today.
 */
export function Company({ id }: { id: string }) {
  const { company: view, today: full } = useCompany(id);
  const { companies } = usePortfolio();
  const { asOf, today } = useAsOf();
  const domain = useMemo(() => timeDomain(companies, today), [companies, today]);
  if (!view || !full) return null;

  const assessed = view.hypotheses.filter((h) => h.history.length);
  const changed = changedThisWeek(view, asOf ?? today);
  const contradicted = view.hypotheses.filter((h) => h.verdict === "contradicts");

  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{view.name}</h1>
          <p className="text-muted-foreground">{view.description}</p>
          <p className="mt-2 text-sm">
            {assessed.length === 0 ? (
              <span className="text-muted-foreground">Not assessed yet.</span>
            ) : (
              <>
                <span className={changed.length ? "font-medium" : "text-muted-foreground"}>
                  {changed.length === 0 ? "No changes this week" : `${changed.length} of ${assessed.length} hypotheses changed this week`}
                </span>
                {contradicted.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · evidence contradicts: {contradicted.map((h) => h.statement.toLowerCase()).join("; ")}
                  </span>
                )}
              </>
            )}
          </p>
        </div>
        {!asOf && (
          <Button variant="outline" onClick={() => openResearch({ job: "research", companyId: id })}>
            Run research
          </Button>
        )}
      </div>

      {asOf && (
        <div className="mt-6">
          <CompanyCompare view={view} full={full} asOf={asOf} />
        </div>
      )}

      <div className="mt-8">
        {view.hypotheses.map((h) => (
          <StripRow
            key={h.id}
            title={h.statement}
            href={companyHypothesisPath(id, h.id)}
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
