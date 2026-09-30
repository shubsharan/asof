import type { SliceRow } from "@/domain/slices";
import type { Company } from "@/domain/types";
import { researchHistory, type HistoryMode } from "@/domain/research";
import { companyHypothesisPath } from "./routes";

/** One row per company with model research on `hypothesisId`, in portfolio order. */
export function companyRows(companies: Company[], hypothesisId: string, mode: HistoryMode = "recorded"): SliceRow[] {
  return companies.flatMap((c) => {
    const h = c.hypotheses.find((x) => x.id === hypothesisId);
    if (!h?.researchHistory) return [];
    const history = researchHistory(h, mode);
    return history.length ? [{ id: c.id, label: c.name, href: `${companyHypothesisPath(c.id, h.id)}?history=${mode}`, history, evidence: h.evidence, mode }] : [];
  });
}

/** One row per hypothesis with model research, titled by the hypothesis's short name. */
export function hypothesisRows(company: Company, mode: HistoryMode = "recorded"): SliceRow[] {
  return company.hypotheses.flatMap((h) => {
    const history = researchHistory(h, mode);
    return history.length ? [{ id: h.id, label: h.name, href: `${companyHypothesisPath(company.id, h.id)}?history=${mode}`, history, evidence: h.evidence, mode }] : [];
  });
}
