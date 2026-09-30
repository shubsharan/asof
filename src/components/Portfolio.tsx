import { researchSummary } from "@/domain/research";
import type { Run } from "@/domain/types";
import { useAsOf } from "./asof";
import { companyHypothesisPath } from "./routes";
import { CompanyAvatar, formatDate, VerdictBadge, withAsOf } from "./shared";
import { usePortfolio } from "./usePortfolio";

/** Company summaries lead to the research and sources behind each question. */
export function Portfolio({ activeRuns }: { activeRuns: Run[] }) {
  const { companiesAsOf: companies, loaded } = usePortfolio();
  const { asOf, setAsOf } = useAsOf();
  if (!loaded) return <p className="text-sm text-muted-foreground">Loading research...</p>;
  return <section>
    <div className="mb-8">
      <h1 className="text-2xl font-semibold">Company research</h1>
      <p className="mt-1 text-muted-foreground">Exa researches the questions you track. Explore the findings and the sources behind them.</p>
    </div>
    {asOf && <p className="mb-4 text-sm">Research as of {formatDate(asOf)}. <button className="underline" onClick={() => setAsOf(undefined)}>Back to latest</button></p>}
    <div className="grid gap-6 lg:grid-cols-2">
      {companies.map((company) => <section key={company.id} className="min-w-0 rounded-lg border bg-card p-5">
        <a className="flex items-center gap-3 font-semibold hover:underline" href={withAsOf(`/c/${company.id}`, asOf)}><CompanyAvatar company={company} /><h2>{company.name}</h2></a>
        <p className="mt-2 text-sm text-muted-foreground">{company.description}</p>
        <div className="mt-4 divide-y">
          {company.hypotheses.map((hypothesis) => {
            const latest = hypothesis.history.at(-1);
            return <a key={hypothesis.id} className="block py-4 hover:bg-muted/30" href={withAsOf(companyHypothesisPath(company.id, hypothesis.id), asOf)}>
              <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-sm font-medium">{hypothesis.name}</h3><VerdictBadge verdict={hypothesis.verdict} /></div>
              {latest && <p className="mt-1 text-xs text-muted-foreground">As of {formatDate(latest.asOf)}</p>}
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{latest ? researchSummary(latest.reasoning).replace(/\*\*/g, "") : hypothesis.statement}</p>
              {activeRuns.some((run) => run.companyId === company.id && run.hypothesisId === hypothesis.id) && <p role="status" className="mt-1 text-xs">Researching...</p>}
            </a>;
          })}
        </div>
      </section>)}
    </div>
    {!companies.length && <p>No companies are being tracked yet.</p>}
    <p className="mt-6 text-xs text-muted-foreground">AI research by Exa. Open a finding to inspect its sources and earlier assessments.</p>
  </section>;
}
