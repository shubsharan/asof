import type { SliceRow } from "@/domain/slices";
import type { Company } from "@/domain/types";
import { companyHypothesisPath } from "./routes";

// The slice chart draws rows; a page decides what a row is. Rows with no assessment are dropped here,
// so the pages keep listing them as "not assessed yet" below the chart.

/** One row per company that has been assessed on `hypothesisId`, in portfolio order. */
export function companyRows(companies: Company[], hypothesisId: string): SliceRow[] {
  return companies.flatMap((c) => {
    const h = c.hypotheses.find((x) => x.id === hypothesisId);
    if (!h || h.history.length === 0) return [];
    return [{ id: c.id, label: c.name, href: companyHypothesisPath(c.id, h.id), history: h.history, evidence: h.evidence }];
  });
}

/** One row per hypothesis the company has been assessed on, titled by the hypothesis's short name. */
export function hypothesisRows(company: Company): SliceRow[] {
  return company.hypotheses
    .filter((h) => h.history.length > 0)
    .map((h) => ({ id: h.id, label: h.name, href: companyHypothesisPath(company.id, h.id), history: h.history, evidence: h.evidence }));
}
