import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { researchView } from "@/domain/research";
import type { Company, PortfolioHypothesis, Run } from "@/domain/types";
import { useAsOf } from "./asof";
import { useApi, usePolling, usePortfolioChanged, useRunsChanged } from "./shared";

// The whole portfolio is fetched once with full history and evidence. Rewinding is a pure
// function of that data (thesisAsOf), so moving the cursor never touches the network.

type Portfolio = {
  /** The hypotheses every company is tracked on, in order. */
  hypotheses: PortfolioHypothesis[];
  /** Every company with everything known today. */
  companies: Company[];
  /** The same companies as of the cursor; identical to `companies` when the cursor is on today. */
  companiesAsOf: Company[];
  activeRuns: Run[];
  loaded: boolean;
  reload: () => Promise<void>;
};

const NONE: Company[] = [];
const NO_HYPOTHESES: PortfolioHypothesis[] = [];
const PortfolioContext = createContext<Portfolio>({ hypotheses: NO_HYPOTHESES, companies: NONE, companiesAsOf: NONE, activeRuns: [], loaded: false, reload: async () => {} });

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { data, reload } = useApi<Company[]>("/api/companies");
  const { data: hypotheses = NO_HYPOTHESES } = useApi<PortfolioHypothesis[]>("/api/hypotheses");
  const { data: runs, reload: reloadRuns } = useApi<Run[]>("/api/runs");
  const { asOf } = useAsOf();
  const knownFinished = useRef<Set<string> | undefined>(undefined);
  const activeRuns = runs?.filter(({ status }) => status === "queued" || status === "running") ?? [];
  useRunsChanged(reloadRuns);
  usePortfolioChanged(reload);
  usePolling(reloadRuns, 5000, true);
  useEffect(() => {
    if (!runs) return;
    const finished = new Set(runs.filter(({ finishedAt }) => !!finishedAt).map(({ id }) => id));
    if (knownFinished.current && [...finished].some((id) => !knownFinished.current!.has(id))) reload();
    knownFinished.current = finished;
  }, [runs, reload]);
  const companies = useMemo(() => data?.map((company) => researchView(company)) ?? NONE, [data]);
  const companiesAsOf = useMemo(() => (asOf ? companies.map((c) => researchView(c, asOf)) : companies), [companies, asOf]);
  const value = useMemo(
    () => ({ hypotheses, companies, companiesAsOf, activeRuns: activeRuns ?? [], loaded: data !== undefined, reload }),
    [hypotheses, companies, companiesAsOf, activeRuns, data, reload],
  );
  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export const usePortfolio = () => useContext(PortfolioContext);
