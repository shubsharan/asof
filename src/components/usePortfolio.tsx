import { createContext, useContext, useMemo } from "react";
import { thesisAsOf } from "@/domain/thesis";
import type { Company } from "@/domain/types";
import { useAsOf } from "./asof";
import { useApi } from "./shared";

// The whole portfolio is fetched once with full history and evidence. Rewinding is a pure
// function of that data (thesisAsOf), so moving the cursor never touches the network.

type Portfolio = {
  /** Every company with everything known today. */
  companies: Company[];
  /** The same companies as of the cursor; identical to `companies` when the cursor is on today. */
  companiesAsOf: Company[];
  loaded: boolean;
  reload: () => Promise<void>;
};

const NONE: Company[] = [];
const PortfolioContext = createContext<Portfolio>({ companies: NONE, companiesAsOf: NONE, loaded: false, reload: async () => {} });

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { data, reload } = useApi<Company[]>("/api/companies");
  const { asOf } = useAsOf();
  const companies = data ?? NONE;
  const companiesAsOf = useMemo(() => (asOf ? companies.map((c) => thesisAsOf(c, asOf)) : companies), [companies, asOf]);
  const value = useMemo(() => ({ companies, companiesAsOf, loaded: data !== undefined, reload }), [companies, companiesAsOf, data, reload]);
  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export const usePortfolio = () => useContext(PortfolioContext);
