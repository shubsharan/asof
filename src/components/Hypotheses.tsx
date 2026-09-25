import { useMemo } from "react";
import { lensesOf, timeDomain } from "@/domain/timeline";
import { useAsOf } from "./asof";
import { hypothesisPath, lensPath } from "./routes";
import { withAsOf } from "./shared";
import { StripRow } from "./StripRow";
import { usePortfolio } from "./usePortfolio";

/**
 * One column of the matrix, expanded: a lens across every company on the shared time axis.
 * Without a lens, every lens in turn. Companies never assessed on a lens are listed, not drawn.
 */
export function Hypotheses({ lens }: { lens?: string }) {
  const { companies, companiesAsOf, loaded } = usePortfolio();
  const { asOf, today } = useAsOf();
  const lenses = useMemo(() => lensesOf(companies), [companies]);
  const domain = useMemo(() => timeDomain(companies, today), [companies, today]);
  if (!loaded) return null;

  const shown = lens ? lenses.filter((l) => l.key === lens) : lenses;
  if (lens && !shown.length) return <p>Not found.</p>;

  return (
    <>
      <h1 className="text-2xl font-semibold">{lens ? shown[0]!.statement : "Hypotheses"}</h1>
      <p className="text-muted-foreground">
        {lens ? "This hypothesis across the portfolio." : "Each hypothesis across the portfolio, on one time axis."}
      </p>

      {shown.map((l) => {
        const rows = companiesAsOf.flatMap((view, i) => {
          const h = view.hypotheses.find((x) => x.lens === l.key);
          const full = companies[i]!.hypotheses.find((x) => x.lens === l.key);
          return h && full ? [{ company: view, h, full }] : [];
        });
        const drawn = rows.filter((r) => r.full.history.length > 0);
        const untested = rows.filter((r) => r.full.history.length === 0);

        return (
          <section key={l.key} className="mt-10">
            {!lens && (
              <h2 className="mb-2 font-medium">
                <a href={withAsOf(lensPath(l.key), asOf)} className="hover:underline">
                  {l.statement}
                </a>
              </h2>
            )}
            {drawn.map(({ company, h, full }) => (
              <StripRow
                key={h.id}
                title={company.name}
                href={hypothesisPath(company.id, h.id)}
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
                  <span key={h.id}>
                    {i > 0 && ", "}
                    <a href={withAsOf(hypothesisPath(company.id, h.id), asOf)} className="underline-offset-2 hover:underline">
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

