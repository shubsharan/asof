import { useEffect, useState } from "react";
import { knownAt } from "@/domain/thesis";
import type { Company, Evidence, Hypothesis } from "@/domain/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CompareWithToday, Timeline } from "./Rewind";
import { api, EvidenceRow, formatDate, StatusBadge, useCompany } from "./shared";

export function TargetOverview({ id, asOf }: { id: string; asOf?: string }) {
  const { company: today, reload } = useCompany(id);
  const { company: past } = useCompany(id, asOf);
  const view = asOf ? past : today;
  const [comparing, setComparing] = useState(false);
  const [monitorNote, setMonitorNote] = useState<string>();

  // Collect whatever the company's Exa monitor has found since the last visit.
  useEffect(() => {
    if (!today?.monitorId) return;
    api<Evidence[]>(`/api/companies/${id}/monitor/pull`, {}).then((added) => {
      setMonitorNote(`Monitor checked just now: ${added.length} new`);
      if (added.length) reload();
    });
  }, [id, today?.monitorId]);

  if (!today || !view) return null;
  const basePath = `/c/${id}`;

  return (
    <>
      <a href="/" className="text-sm text-muted-foreground">
        ← Portfolio
      </a>
      <h1 className="mt-2 text-2xl font-semibold">{view.name}</h1>
      <p className="text-muted-foreground">{view.description}</p>

      <Timeline today={today} asOf={asOf} basePath={basePath} />

      {asOf && (
        <Alert className="mb-6">
          <AlertTitle>Viewing AsOf as of {formatDate(asOf)}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            The thesis and evidence below are what was available on that date.
            <Button size="sm" variant="outline" onClick={() => setComparing(!comparing)}>
              {comparing ? "Hide comparison" : "Compare with today"}
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <a href={basePath}>Back to today</a>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {asOf && comparing && (
        <div className="mb-6">
          <CompareWithToday then={view} today={today} asOf={asOf} />
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="mb-3 font-medium">Investment thesis</h2>
          <div className="grid gap-3">
            {view.hypotheses.map((h) => (
              <HypothesisCard key={h.id} companyId={id} hypothesis={h} asOf={asOf} />
            ))}
          </div>
        </section>
        <section>
          <h2 className="mb-3 font-medium">Recent evidence</h2>
          {monitorNote && !asOf && <p className="mb-2 text-xs text-muted-foreground">{monitorNote}</p>}
          <EvidenceFeed company={view} />
        </section>
      </div>
    </>
  );
}

function HypothesisCard({ companyId, hypothesis: h, asOf }: { companyId: string; hypothesis: Hypothesis; asOf?: string }) {
  return (
    <a href={`/c/${companyId}/h/${h.id}${asOf ? `?asOf=${asOf}` : ""}`}>
      <Card className="transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardTitle className="text-base">{h.statement}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Progress value={h.confidence ?? 0} className="flex-1" />
          <span className="w-10 text-right text-sm tabular-nums">{h.confidence === undefined ? "—" : `${h.confidence}%`}</span>
          <StatusBadge status={h.status} />
        </CardContent>
      </Card>
    </a>
  );
}

/** The most recently knowable evidence across all hypotheses. */
function EvidenceFeed({ company }: { company: Company }) {
  const items = company.hypotheses
    .flatMap((h) => h.evidence.map((e) => ({ e, statement: h.statement })))
    .sort((a, b) => knownAt(b.e).localeCompare(knownAt(a.e)))
    .slice(0, 12);
  return (
    <ul className="divide-y">
      {items.map(({ e, statement }) => (
        <EvidenceRow key={e.id} evidence={e} context={statement} />
      ))}
    </ul>
  );
}
