// Bun.serve returns the app for every path, and links are plain page loads, so the URL is parsed once.
// Every view draws the same confidence strip at a different zoom: the portfolio matrix, one lens across
// companies, one company across lenses, one cell. Any page takes ?asOf=YYYY-MM-DD; the scrubber rewrites it.

export type Route =
  | { page: "portfolio" }
  | { page: "hypotheses"; lens?: string }
  | { page: "updates" }
  | { page: "settings" }
  | { page: "company"; companyId: string }
  | { page: "hypothesis"; companyId: string; hypothesisId: string }
  | { page: "not-found" };

export function parseRoute(pathname: string): Route {
  const [first, second, third, fourth, ...rest] = pathname.split("/").filter(Boolean);
  if (!first) return { page: "portfolio" };
  if (first === "hypotheses" && !third) return { page: "hypotheses", lens: second };
  if ((first === "updates" || first === "settings") && !second) return { page: first };
  if (first === "c" && second && !rest.length) {
    if (third === "h" && fourth) return { page: "hypothesis", companyId: second, hypothesisId: fourth };
    if (!third) return { page: "company", companyId: second };
  }
  return { page: "not-found" };
}

export const lensPath = (lens: string) => `/hypotheses/${lens}`;
export const companyPath = (companyId: string) => `/c/${companyId}`;
export const hypothesisPath = (companyId: string, hypothesisId: string) => `/c/${companyId}/h/${hypothesisId}`;
