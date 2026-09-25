import { knownAt } from "./thesis";
import type { Company, Update } from "./types";

/**
 * Every piece of evidence across the portfolio, newest first by when it became knowable.
 * Evidence is the atomic unit here: no assessments or confidence moves, just what was found and
 * which way it points. Pass companies already viewed as of the cursor (`thesisAsOf`).
 */
export function updatesFeed(companies: Company[], { limit = 100 }: { limit?: number } = {}): Update[] {
  const updates = companies.flatMap((c) =>
    c.hypotheses.flatMap((h) =>
      h.evidence.map((evidence) => ({
        at: knownAt(evidence),
        company: { id: c.id, name: c.name },
        hypothesis: { id: h.id, name: h.name, statement: h.statement },
        evidence,
      })),
    ),
  );
  return updates.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
