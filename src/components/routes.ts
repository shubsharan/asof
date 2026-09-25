// Bun.serve returns the app for every path, and links are plain page loads, so the URL is parsed once.
// Every view is a zoom on the same grid of companies × portfolio hypotheses: the portfolio, one hypothesis
// across companies, one company across hypotheses, one company on one hypothesis. Any page takes ?asOf=YYYY-MM-DD; the scrubber rewrites it.

export type Route =
  | { page: "portfolio" }
  | { page: "hypotheses"; hypothesisId?: string }
  | { page: "updates" }
  | { page: "settings" }
  | { page: "company"; companyId: string }
  | { page: "hypothesis"; companyId: string; hypothesisId: string }
  | { page: "not-found" };

export function parseRoute(pathname: string): Route {
  const [first, second, third, fourth, ...rest] = pathname.split("/").filter(Boolean);
  if (!first) return { page: "portfolio" };
  if (first === "hypotheses" && !third) return { page: "hypotheses", hypothesisId: second };
  if ((first === "updates" || first === "settings") && !second) return { page: first };
  if (first === "c" && second && !rest.length) {
    if (third === "h" && fourth) return { page: "hypothesis", companyId: second, hypothesisId: fourth };
    if (!third) return { page: "company", companyId: second };
  }
  return { page: "not-found" };
}

export const hypothesisPath = (hypothesisId: string) => `/hypotheses/${hypothesisId}`;
export const companyPath = (companyId: string) => `/c/${companyId}`;
export const companyHypothesisPath = (companyId: string, hypothesisId: string) => `/c/${companyId}/h/${hypothesisId}`;
