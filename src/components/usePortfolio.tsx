import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { researchView } from "@/domain/research";
import type { Company, PortfolioHypothesis, Run } from "@/domain/types";
import { useAsOf } from "./asof";
import { useApi, usePolling, usePortfolioChanged, useRunsChanged } from "./shared";

// Fetch raw history once; the browser and API use the same pure research selector.

type Portfolio = {
  /** The hypotheses every company is tracked on, in order. */
  hypotheses: PortfolioHypothesis[];
  rawCompanies: Company[];
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
const PortfolioContext = createContext<Portfolio>({ hypotheses: NO_HYPOTHESES, rawCompanies: NONE, companies: NONE, companiesAsOf: NONE, activeRuns: [], loaded: false, reload: async () => {} });

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { data, reload } = useApi<Company[]>("/api/companies?raw=1");
  const { data: hypotheses = NO_HYPOTHESES } = useApi<PortfolioHypothesis[]>("/api/hypotheses");
  const { data: runs, reload: reloadRuns } = useApi<Run[]>("/api/runs");
  const { asOf, mode, assessmentId } = useAsOf();
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
  const companies = useMemo(() => data?.map((company) => researchView(company, undefined, mode)) ?? NONE, [data, mode]);
  const companiesAsOf = useMemo(() => data?.map((c) => researchView(c, asOf, mode, assessmentId)) ?? NONE, [data, asOf, mode, assessmentId]);
  const value = useMemo(
    () => ({ hypotheses, rawCompanies: data ?? NONE, companies, companiesAsOf, activeRuns: activeRuns ?? [], loaded: data !== undefined, reload }),
    [hypotheses, companies, companiesAsOf, activeRuns, data, reload],
  );
  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export const usePortfolio = () => useContext(PortfolioContext);
