import { useMemo } from "react";
import { timeDomain } from "@/domain/timeline";
import { useAsOf } from "./asof";
import { companyHypothesisPath, hypothesisPath } from "./routes";
import { CompanyAvatar, withAsOf } from "./shared";
import { StripRow } from "./StripRow";
import { usePortfolio } from "./usePortfolio";

/**
 * One portfolio hypothesis across every company on the shared time axis. Without one, every
 * hypothesis in turn. Companies never assessed on it are listed, not drawn.
 */
export function Hypotheses({ hypothesisId }: { hypothesisId?: string }) {
  const { hypotheses, companies, companiesAsOf, loaded } = usePortfolio();
  const { asOf, today } = useAsOf();
  const domain = useMemo(() => timeDomain(companies, today), [companies, today]);
  if (!loaded) return null;

  const shown = hypothesisId ? hypotheses.filter((ph) => ph.id === hypothesisId) : hypotheses;
  if (hypothesisId && !shown.length) return <p>Not found.</p>;

  return (
    <>
      <h1 className="text-2xl font-semibold">{hypothesisId ? shown[0]!.statement : "Hypotheses"}</h1>
      <p className="text-muted-foreground">
        {hypothesisId ? "This hypothesis across the portfolio." : "Each hypothesis across the portfolio, on one time axis."}
      </p>

      {shown.map((ph) => {
        const rows = companiesAsOf.flatMap((view, i) => {
          const h = view.hypotheses.find((x) => x.id === ph.id);
          const full = companies[i]!.hypotheses.find((x) => x.id === ph.id);
          return h && full ? [{ company: view, h, full }] : [];
        });
        const drawn = rows.filter((r) => r.full.history.length > 0);
        const untested = rows.filter((r) => r.full.history.length === 0);

        return (
          <section key={ph.id} className="mt-10">
            {!hypothesisId && (
              <h2 className="mb-2 font-medium">
                <a href={withAsOf(hypothesisPath(ph.id), asOf)} className="hover:underline">
                  {ph.statement}
                </a>
              </h2>
            )}
            {drawn.map(({ company, h, full }) => (
              <StripRow
                key={company.id}
                title={company.name}
                avatar={<CompanyAvatar company={company} />}
                href={companyHypothesisPath(company.id, h.id)}
                hypothesis={h}
                full={full}
                domain={domain}
                asOf={asOf}
                today={today}
              />
            ))}
            {untested.length > 0 && (
              <p className="border-t py-4 text-sm text-muted-foreground">
                Not assessed yet:{" "}
                {untested.map(({ company, h }, i) => (
                  <span key={company.id}>
                    {i > 0 && ", "}
                    <a href={withAsOf(companyHypothesisPath(company.id, h.id), asOf)} className="underline-offset-2 hover:underline">
                      {company.name}
                    </a>
                  </span>
                ))}
                .
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

