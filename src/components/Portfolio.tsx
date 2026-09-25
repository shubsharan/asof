import type { Run } from "@/domain/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAsOf } from "./asof";
import { companyHypothesisPath, hypothesisPath } from "./routes";
import { formatConfidence, tone, withAsOf } from "./shared";
import { usePortfolio } from "./usePortfolio";

/**
 * Home: one card per hypothesis, one row per company with its verdict at the cursor and how
 * confident that verdict is. No deltas: a move only means something against a chosen comparison date.
 */
export function Portfolio({ activeRuns }: { activeRuns: Run[] }) {
  const { hypotheses, companiesAsOf, loaded } = usePortfolio();
  const { asOf } = useAsOf();
  const busy = new Set(activeRuns.map((r) => `${r.companyId}/${r.hypothesisId ?? ""}`));

  if (!loaded) return null;

  return (
    <section className="min-w-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-muted-foreground">Which way the evidence points for each company, and how confident that verdict is. Drag the timeline to see what was known when.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {hypotheses.map((ph) => (
          <Card key={ph.id} className="gap-4">
            <CardHeader>
              <CardTitle>
                <a href={withAsOf(hypothesisPath(ph.id), asOf)} className="hover:underline">
                  {ph.name}
                </a>
              </CardTitle>
              <CardDescription>{ph.statement}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="-mx-2">
                {companiesAsOf.map((c) => {
                  const h = c.hypotheses.find((x) => x.id === ph.id);
                  if (!h) return null;
                  const untested = h.verdict === "untested";
                  return (
                    <li key={c.id}>
                      <a href={withAsOf(companyHypothesisPath(c.id, h.id), asOf)} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted/50">
                        <span className={`size-2 shrink-0 rounded-full ${tone(h.verdict).dot}`} aria-hidden />
                        <span className={`min-w-0 truncate ${untested ? "text-muted-foreground" : "font-medium"}`}>{c.name}</span>
                        {(busy.has(`${c.id}/${h.id}`) || busy.has(`${c.id}/`)) && (
                          <span className="size-2 shrink-0 animate-pulse rounded-full bg-sky-500" title="Research running" />
                        )}
                        <span className="ml-auto text-xs text-muted-foreground">{h.verdict}</span>
                        <span
                          className={`w-12 rounded px-1.5 py-0.5 text-right font-mono tabular-nums ${tone(h.verdict).solid}`}
                          title={untested ? undefined : `${h.confidence}% confident the evidence ${h.verdict === "neutral" ? "is neutral on" : h.verdict} this`}
                        >
                          {formatConfidence(h.confidence)}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
