import { knownAt } from "./thesis";
import type { Company, Evidence, Run, Update } from "./types";

const day = (iso: string) => iso.slice(0, 10);

/**
 * What changed across the portfolio, newest first: every assessment (with the one before it),
 * evidence batched per hypothesis per day it became knowable, and failed runs.
 * Pass companies already viewed as of the cutoff (`thesisAsOf`); runs are cut off by `asOf` here.
 */
export function updatesFeed(companies: Company[], failedRuns: Run[], { asOf, limit = 100 }: { asOf?: string; limit?: number } = {}): Update[] {
  const updates: Update[] = [];

  for (const c of companies) {
    const company = { id: c.id, name: c.name };
    for (const h of c.hypotheses) {
      const hypothesis = { id: h.id, statement: h.statement };
      h.history.forEach((v, i) => {
        const prev = h.history[i - 1];
        updates.push({
          kind: "assessment",
          at: v.asOf,
          company,
          hypothesis,
          before: prev ? { confidence: prev.confidence, status: prev.status } : { confidence: undefined, status: "untested" },
          after: { confidence: v.confidence, status: v.status },
        });
      });

      const byDay = Map.groupBy(h.evidence, (e) => day(knownAt(e)));
      for (const evidence of byDay.values()) {
        const latest = evidence.map(knownAt).sort().at(-1)!;
        updates.push({ kind: "evidence", at: latest, company, hypothesis, evidence: evidence.toSorted(byKnownAtDesc) });
      }
    }
  }

  for (const run of failedRuns) {
    const at = run.finishedAt ?? run.createdAt;
    if (asOf && day(at) > day(asOf)) continue;
    const c = companies.find((x) => x.id === run.companyId);
    if (!c) continue;
    const h = c.hypotheses.find((x) => x.id === run.hypothesisId);
    updates.push({
      kind: "run-failed",
      at,
      company: { id: c.id, name: c.name },
      hypothesis: h && { id: h.id, statement: h.statement },
      run,
    });
  }

  return updates.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

const byKnownAtDesc = (a: Evidence, b: Evidence) => knownAt(b).localeCompare(knownAt(a));
