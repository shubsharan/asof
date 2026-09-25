import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { Company, Hypothesis, PortfolioHypothesis, Run } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAsOf } from "./asof";
import { companyHypothesisPath, hypothesisPath } from "./routes";
import { CompanyAvatar, formatConfidence, VerdictBadge, withAsOf } from "./shared";
import { usePortfolio } from "./usePortfolio";

export type SortKey = "company" | "verdict" | "confidence";
export type Sort = { key: SortKey; reversed: boolean };
type Row = { company: Company; h: Hypothesis };

const VERDICT_ORDER: Record<Hypothesis["verdict"], number> = { supports: 0, neutral: 1, contradicts: 2, untested: 3 };

/**
 * Each column's natural order: company A–Z, verdict supports → neutral → contradicts, confidence
 * 100 → 0. Untested rows stay last either way; ties fall back to company name.
 */
const COMPARE: Record<SortKey, (a: Row, b: Row) => number> = {
  company: (a, b) => a.company.name.localeCompare(b.company.name),
  verdict: (a, b) => VERDICT_ORDER[a.h.verdict] - VERDICT_ORDER[b.h.verdict],
  confidence: (a, b) => (b.h.confidence ?? -1) - (a.h.confidence ?? -1),
};

/** Rows in `sort` order (reversed on a second click), or portfolio order with no sort. */
export function sortRows(rows: Row[], sort?: Sort): Row[] {
  if (!sort) return rows;
  const untested = (r: Row) => r.h.verdict === "untested";
  return rows.toSorted((a, b) => {
    if (untested(a) !== untested(b)) return untested(a) ? 1 : -1;
    const order = COMPARE[sort.key](a, b) * (sort.reversed ? -1 : 1);
    return order || COMPARE.company(a, b);
  });
}

/**
 * Home: one card per hypothesis, a table of each company's verdict at the cursor (color coded)
 * and how confident that verdict is (plain, so color only ever means direction). No deltas: a move
 * only means something against a chosen comparison date.
 */
export function Portfolio({ activeRuns }: { activeRuns: Run[] }) {
  const { hypotheses, companiesAsOf, loaded } = usePortfolio();
  const busy = new Set(activeRuns.map((r) => `${r.companyId}/${r.hypothesisId ?? ""}`));

  if (!loaded) return null;

  return (
    <section className="min-w-0">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-muted-foreground">Which way the evidence points for each company, and how confident that verdict is. Drag the timeline to see what was known when.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {hypotheses.map((ph) => (
          <HypothesisCard
            key={ph.id}
            hypothesis={ph}
            rows={companiesAsOf.flatMap((company) => {
              const h = company.hypotheses.find((x) => x.id === ph.id);
              return h ? [{ company, h }] : [];
            })}
            busy={busy}
          />
        ))}
      </div>
    </section>
  );
}

/** One hypothesis across the portfolio; each card keeps its own sort. */
function HypothesisCard({ hypothesis: ph, rows, busy }: { hypothesis: PortfolioHypothesis; rows: Row[]; busy: Set<string> }) {
  const { asOf } = useAsOf();
  const [sort, setSort] = useState<Sort>();
  // First click sorts in the column's natural order, the next reverses it.
  const sortBy = (key: SortKey) => setSort((s) => ({ key, reversed: s?.key === key && !s.reversed }));
  const header = (key: SortKey, label: string) => (
    <SortHeader label={label} active={sort?.key === key ? sort : undefined} onClick={() => sortBy(key)} alignEnd={key === "confidence"} />
  );

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle>
          <a href={withAsOf(hypothesisPath(ph.id), asOf)} className="hover:underline">
            {ph.name}
          </a>
        </CardTitle>
        <CardDescription>{ph.statement}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Fixed layout: Company takes whatever width is left; Verdict and Confidence stay narrow on the right. */}
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-0" aria-sort={ariaSort(sort, "company")}>
                {header("company", "Company")}
              </TableHead>
              <TableHead className="w-28" aria-sort={ariaSort(sort, "verdict")}>
                {header("verdict", "Verdict")}
              </TableHead>
              <TableHead className="w-32 pr-0 text-right" aria-sort={ariaSort(sort, "confidence")}>
                {header("confidence", "Confidence")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortRows(rows, sort).map(({ company: c, h }) => {
              const untested = h.verdict === "untested";
              const href = withAsOf(companyHypothesisPath(c.id, h.id), asOf);
              return (
                // The whole row opens the company's hypothesis; the name stays a real link for keyboard and new-tab use.
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    if (!(e.target as HTMLElement).closest("a")) location.href = href;
                  }}
                >
                  <TableCell className="pl-0">
                    <a href={href} className="flex min-w-0 items-center gap-2">
                      <CompanyAvatar company={c} className={`size-6 ${untested ? "opacity-60 grayscale" : ""}`} />
                      <span className={`truncate ${untested ? "text-muted-foreground" : "font-medium"}`}>{c.name}</span>
                      {(busy.has(`${c.id}/${h.id}`) || busy.has(`${c.id}/`)) && (
                        <span className="size-2 shrink-0 animate-pulse rounded-full bg-sky-500" title="Research running" />
                      )}
                    </a>
                  </TableCell>
                  <TableCell>
                    <VerdictBadge verdict={h.verdict} />
                  </TableCell>
                  <TableCell className={`pr-0 text-right font-mono tabular-nums ${untested ? "text-muted-foreground" : ""}`}>
                    {formatConfidence(h.confidence)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const ariaSort = (sort: Sort | undefined, key: SortKey) =>
  sort?.key !== key ? undefined : (key === "confidence") !== sort.reversed ? "descending" : "ascending";

/** The column label as a ghost button, nudged so its text lines up with the cells below. */
function SortHeader({ label, active, onClick, alignEnd }: { label: string; active?: Sort; onClick: () => void; alignEnd?: boolean }) {
  const Icon = !active ? ArrowUpDown : active.reversed ? ArrowUp : ArrowDown;
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className={`h-8 px-2 font-medium ${alignEnd ? "pr-0" : "-ml-2"}`}>
      {label}
      <Icon className={active ? "" : "text-muted-foreground/60"} />
    </Button>
  );
}
