import { knownAt } from "./thesis";
import type { Company, Update } from "./types";

/**
 * Every piece of evidence across the portfolio, newest first by its recorded timestamp.
 * Date bounds are inclusive UTC calendar days and apply before an optional result limit.
 */
export function updatesFeed(companies: Company[], { from, to, limit }: { from?: string; to?: string; limit?: number } = {}): Update[] {
  const updates = companies.flatMap((c) =>
    c.hypotheses.flatMap((h) =>
      h.evidence.map((evidence) => ({
        at: knownAt(evidence),
        company: { id: c.id, name: c.name, domain: c.domain },
        hypothesis: { id: h.id, name: h.name, statement: h.statement },
        evidence,
      })),
    ),
  );
  const inRange = updates.filter(({ at }) => {
    const recordedDay = at.slice(0, 10);
    return (!from || recordedDay >= from) && (!to || recordedDay <= to);
  });
  const sorted = inRange.sort((a, b) => b.at.localeCompare(a.at));
  return limit === undefined ? sorted : sorted.slice(0, limit);
}
