import { useAsOf } from "./asof";
import { companyHypothesisPath, hypothesisPath } from "./routes";
import { CompanyAvatar, withAsOf } from "./shared";
import { companyRows } from "./sliceRows";
import { StripRow } from "./StripRow";
import { SliceChartCard } from "./SliceChartCard";
import { usePortfolio } from "./usePortfolio";
import { HistoryControls } from "./TimeScrubber";

/**
 * One portfolio hypothesis across every company, or every hypothesis in turn.
 */
export function Hypotheses({ hypothesisId }: { hypothesisId?: string }) {
  const { hypotheses, companies, companiesAsOf, loaded } = usePortfolio();
  const { asOf, mode } = useAsOf();
  if (!loaded) return null;

  const shown = hypothesisId ? hypotheses.filter((ph) => ph.id === hypothesisId) : hypotheses;
  if (hypothesisId && !shown.length) return <p>Not found.</p>;

  return (
    <>
      <h1 className="text-2xl font-semibold">{hypothesisId ? shown[0]!.statement : "Hypotheses"}</h1>
      <p className="text-muted-foreground">
        {hypothesisId ? "This hypothesis across the portfolio." : "Exa research across companies."}
      </p>
      <HistoryControls hypothesisId={hypothesisId} />

      {shown.map((ph) => {
        const rows = companiesAsOf.flatMap((view, i) => {
          const h = view.hypotheses.find((x) => x.id === ph.id);
          const full = companies[i]!.hypotheses.find((x) => x.id === ph.id);
          return h && full ? [{ company: view, h, full }] : [];
        });
        const researchRows = companyRows(companies, ph.id, mode);

        return (
          <section key={ph.id} className="mt-10">
            {!hypothesisId && (
              <h2 className="mb-2 font-medium">
                <a href={withAsOf(hypothesisPath(ph.id), asOf)} className="hover:underline">
                  {ph.statement}
                </a>
              </h2>
            )}
            {hypothesisId && researchRows.length > 0 && (
              <details className="mb-8 rounded border p-4">
                <summary className="cursor-pointer font-medium">Research over time</summary>
                <p className="mt-2 text-sm text-muted-foreground">{mode === "recorded" ? "Recorded assessments and when evidence was collected." : "Retrospective assessments by research cutoff. Source dots use publication dates, not when AsOf knew them."}</p>
                <div className="mt-4">
                  <SliceChartCard
                    rows={researchRows}
                    avatar={(rowId) => {
                      const c = companies.find((x) => x.id === rowId);
                      return c ? <CompanyAvatar company={c} className="size-4" /> : null;
                    }}
                  />
                </div>
              </details>
            )}
            {rows.map(({ company, h, full }) => (
              <StripRow
                key={company.id}
                title={company.name}
                avatar={<CompanyAvatar company={company} />}
                href={companyHypothesisPath(company.id, h.id)}
                hypothesis={h}
                full={full}
                asOf={asOf}
              />
            ))}
          </section>
        );
      })}
    </>
  );
}
