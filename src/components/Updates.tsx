import { useMemo, useState } from "react";
import { updatesFeed } from "@/domain/updates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAsOf } from "./asof";
import { companyPath, companyHypothesisPath } from "./routes";
import { CompanyAvatar, EvidenceTypeBadge, formatDate, withAsOf } from "./shared";
import { usePortfolio } from "./usePortfolio";

const LIMIT = 200;
const ALL = "all";

/** Evidence across the portfolio up to the cursor, newest first: one row each, tagged with the way it points. */
export function Updates() {
  const { companiesAsOf, loaded } = usePortfolio();
  const { asOf } = useAsOf();
  const [companyId, setCompanyId] = useState(ALL);
  const updates = useMemo(
    () => updatesFeed(companiesAsOf.filter((c) => companyId === ALL || c.id === companyId), { limit: LIMIT }),
    [companiesAsOf, companyId],
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Updates</h1>
          <p className="text-muted-foreground">New evidence, newest first{asOf ? `, as known by ${formatDate(asOf)}` : ""}.</p>
        </div>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger size="sm" className="ml-auto w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All companies</SelectItem>
            {companiesAsOf.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {loaded && updates.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Start a run from Runs in the sidebar.</p>}
      {updates.length > 0 && (
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28 pl-4">Date</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Hypothesis</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead className="pr-4">Tag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {updates.map(({ at, company, hypothesis, evidence: e }) => (
                <TableRow key={e.id} className="align-top">
                  <TableCell className="pl-4 align-top font-mono text-xs text-muted-foreground tabular-nums">{formatDate(at)}</TableCell>
                  <TableCell className="align-top">
                    <a href={withAsOf(companyPath(company.id), asOf)} className="flex items-center gap-2 font-medium hover:underline">
                      <CompanyAvatar company={company} className="size-5" />
                      {company.name}
                    </a>
                  </TableCell>
                  <TableCell className="max-w-56 align-top whitespace-normal">
                    <a href={withAsOf(companyHypothesisPath(company.id, hypothesis.id), asOf)} className="hover:underline" title={hypothesis.statement}>
                      {hypothesis.statement}
                    </a>
                  </TableCell>
                  <TableCell className="min-w-72 align-top whitespace-normal">
                    <p>{e.claim}</p>
                    <a href={e.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline">
                      {e.title}
                    </a>
                  </TableCell>
                  <TableCell className="pr-4 align-top">
                    <EvidenceTypeBadge type={e.type} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
