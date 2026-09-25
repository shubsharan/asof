import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, FileText, Sparkles, TriangleAlert } from "lucide-react";
import { updatesFeed } from "@/domain/updates";
import type { Run, Update } from "@/domain/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAsOf } from "./asof";
import { hypothesisPath } from "./routes";
import { EvidenceRow, formatConfidence, formatDate, openResearch, RUN_KIND_LABELS, StatusBadge, useApi, useRunsChanged, withAsOf } from "./shared";
import { usePortfolio } from "./usePortfolio";

const LIMIT = 100;
const ALL = "all";

/** What changed across the portfolio up to the cursor: assessments, evidence as it became knowable, failed runs. */
export function Updates() {
  const { companiesAsOf, loaded } = usePortfolio();
  const { asOf } = useAsOf();
  const [companyId, setCompanyId] = useState(ALL);
  const { data: failed, reload } = useApi<Run[]>("/api/runs?failed=1");
  useRunsChanged(reload);
  const updates = useMemo(
    () => updatesFeed(companiesAsOf.filter((c) => companyId === ALL || c.id === companyId), failed ?? [], { asOf, limit: LIMIT }),
    [companiesAsOf, companyId, failed, asOf],
  );
  const days = [...Map.groupBy(updates, (u) => u.at.slice(0, 10))];

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Updates</h1>
          <p className="text-muted-foreground">
            Assessments, new evidence and failed runs, newest first{asOf ? `, as known by ${formatDate(asOf)}` : ""}.
          </p>
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
      {loaded && updates.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet. Start a run from Research in the sidebar.</p>}
      {days.map(([day, items]) => (
        <section key={day} className="mb-6">
          <h2 className="mb-1 font-mono text-xs text-muted-foreground">{formatDate(day)}</h2>
          <ul className="divide-y rounded-lg border">
            {items.map((u, i) => (
              <Row key={i} update={u} asOf={asOf} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Row({ update: u, asOf }: { update: Update; asOf?: string }) {
  const subject = (
    <span className="min-w-0">
      <span className="font-medium">{u.company.name}</span>
      {u.hypothesis && <span className="text-muted-foreground"> · {u.hypothesis.statement}</span>}
    </span>
  );

  if (u.kind === "assessment") {
    const { before, after } = u;
    const delta = before.confidence === undefined || after.confidence === undefined ? undefined : after.confidence - before.confidence;
    const Icon = delta === undefined ? Sparkles : delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : ArrowRight;
    const tone = delta === undefined ? "text-sky-600" : delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-700" : "text-muted-foreground";
    return (
      <li>
        <a href={withAsOf(hypothesisPath(u.company.id, u.hypothesis.id), asOf)} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40">
          <Icon className={`size-4 shrink-0 ${tone}`} />
          {subject}
          <span className="ml-auto flex items-center gap-2 font-mono text-xs tabular-nums">
            {delta === undefined ? <span className="text-muted-foreground">first assessment</span> : <span className="text-muted-foreground">{formatConfidence(before.confidence)} →</span>}
            <span className="text-sm font-medium">{formatConfidence(after.confidence)}</span>
            {before.status !== after.status && before.status !== "untested" && (
              <>
                <StatusBadge status={before.status} />→
              </>
            )}
            <StatusBadge status={after.status} />
          </span>
        </a>
      </li>
    );
  }

  if (u.kind === "evidence") {
    const count = (type: string) => u.evidence.filter((e) => e.type === type).length;
    const breakdown = [["supports", count("supports")], ["contradicts", count("contradicts")]].filter(([, n]) => n);
    return (
      <li className="px-4 py-3 text-sm">
        <details>
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            {subject}
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              +{u.evidence.length} evidence{breakdown.length > 0 && ` (${breakdown.map(([t, n]) => `${n} ${t}`).join(", ")})`}
            </span>
          </summary>
          <ul className="mt-2 ml-7 divide-y border-t">
            {u.evidence.map((e) => (
              <EvidenceRow key={e.id} evidence={e} />
            ))}
          </ul>
        </details>
      </li>
    );
  }

  return (
    <li>
      <button type="button" onClick={() => openResearch()} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40">
        <TriangleAlert className="size-4 shrink-0 text-destructive" />
        {subject}
        <span className="ml-auto max-w-full truncate text-xs text-destructive" title={u.run.error}>
          {RUN_KIND_LABELS[u.run.kind]} run failed: {u.run.error}
        </span>
      </button>
    </li>
  );
}
