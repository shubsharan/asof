import { useEffect, useMemo, useState } from "react";
import { updatesFeed } from "@/domain/updates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { companyPath, companyHypothesisPath } from "./routes";
import { SourceInspector } from "./SnapshotDialog";
import { CompanyAvatar, EvidenceTypeBadge, formatDateTime } from "./shared";
import { usePortfolio } from "./usePortfolio";

const ALL = "all";

const dateParam = (name: string) => new URLSearchParams(location.search).get(name) ?? "";

/** Evidence across the current portfolio, newest first by when AsOf recorded it. */
export function Updates() {
  const { companies, loaded } = usePortfolio();
  const [companyId, setCompanyId] = useState(ALL);
  const [from, setFrom] = useState(() => dateParam("from"));
  const [to, setTo] = useState(() => dateParam("to"));
  const rangeError = from && to && from > to ? "Recorded from must be on or before recorded to." : undefined;
  useEffect(() => {
    const url = new URL(location.href);
    from ? url.searchParams.set("from", from) : url.searchParams.delete("from");
    to ? url.searchParams.set("to", to) : url.searchParams.delete("to");
    history.replaceState(history.state, "", url);
  }, [from, to]);
  const updates = useMemo(
    () => rangeError ? [] : updatesFeed(companies.filter((c) => companyId === ALL || c.id === companyId), { from: from || undefined, to: to || undefined }),
    [companies, companyId, from, rangeError, to],
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Updates</h1>
          <p className="text-muted-foreground">Recent sources found by Exa. Open a question to see what they mean.</p>
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">Recorded from<input type="date" className="h-8 rounded border bg-background px-2 text-sm text-foreground" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="grid gap-1 text-xs text-muted-foreground">Recorded to<input type="date" className="h-8 rounded border bg-background px-2 text-sm text-foreground" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger size="sm" className="ml-auto w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {rangeError && <p role="alert" className="mb-4 text-sm text-destructive">{rangeError}</p>}
      {loaded && !rangeError && updates.length === 0 && <p className="text-sm text-muted-foreground">No evidence was recorded in this range.</p>}
      {updates.length > 0 && (
        <div className="rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36 pl-4">Recorded</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Hypothesis</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead className="pr-4">Tag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {updates.map(({ at, company, hypothesis, evidence: e }) => (
                <TableRow key={e.id} className="align-top">
                  <TableCell className="pl-4 align-top font-mono text-xs text-muted-foreground tabular-nums">{formatDateTime(at)}</TableCell>
                  <TableCell className="align-top">
                    <a href={companyPath(company.id)} className="flex items-center gap-2 font-medium hover:underline">
                      <CompanyAvatar company={company} className="size-5" />
                      {company.name}
                    </a>
                  </TableCell>
                  <TableCell className="max-w-56 align-top whitespace-normal">
                    <a href={companyHypothesisPath(company.id, hypothesis.id)} className="hover:underline" title={hypothesis.statement}>
                      {hypothesis.statement}
                    </a>
                  </TableCell>
                  <TableCell className="min-w-72 align-top whitespace-normal">
                    <p>{e.claim}</p>
                    <div className="mt-1 text-xs text-muted-foreground [&_button]:text-xs [&_button]:text-muted-foreground"><SourceInspector evidence={e} /></div>
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
