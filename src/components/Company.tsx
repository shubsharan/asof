import { useEffect, useRef, useState } from "react";
import type { Run, WatchState } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { useAsOf } from "./asof";
import { CompanyCompare } from "./Compare";
import { companyHypothesisPath } from "./routes";
import { api, CompanyAvatar, formatDateTime, notifyRunsChanged, openResearch, useApi, useCompany, usePolling } from "./shared";
import { hypothesisRows } from "./sliceRows";
import { StripRow } from "./StripRow";
import { SliceChartCard } from "./SliceChartCard";
import { usePortfolio } from "./usePortfolio";
import { HistoryControls } from "./TimeScrubber";

/**
 * One company with its current analyst conclusions and separate model research history.
 */
export function Company({ id }: { id: string }) {
  const { company: view, today: full, reload } = useCompany(id);
  const { asOf, mode } = useAsOf();
  if (!view || !full) return null;

  const assessed = view.hypotheses.filter((h) => h.history.length);
  const researchRows = hypothesisRows(full, mode);

  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-3 text-2xl font-semibold">
            <CompanyAvatar company={view} className="size-8" />
            {view.name}
          </h1>
          <p className="text-muted-foreground">{view.description}</p>
          <p className="mt-2 text-sm">
            {assessed.length === 0 ? <span className="text-muted-foreground">No AI assessments yet.</span> : `${assessed.length} of ${view.hypotheses.length} questions researched`}
          </p>
        </div>
        {!asOf && mode === "recorded" && (
          <Button variant="outline" onClick={() => openResearch({ job: "assess", companyId: id })}>
            Research a question
          </Button>
        )}
      </div>

      <HistoryControls companyId={id} />
      {!asOf && mode === "recorded" && <WatchPanel companyId={id} onChanged={reload} />}

      {researchRows.length > 0 && (
        <details className="mt-6 rounded border p-4">
          <summary className="cursor-pointer font-medium">Research over time</summary>
          <p className="mt-2 text-sm text-muted-foreground">{mode === "recorded" ? "Recorded assessments and when evidence was collected." : "Retrospective assessments by research cutoff. Source dots use publication dates, not when AsOf knew them."}</p>
          <div className="mt-4">
            <SliceChartCard rows={researchRows} />
          </div>
        </details>
      )}

      {asOf && mode === "recorded" && (
        <div className="mt-6">
          <CompanyCompare view={view} full={full} asOf={asOf} />
        </div>
      )}

      <div className="mt-8">
        {view.hypotheses.map((h) => (
          <StripRow
            key={h.id}
            title={h.statement}
            href={companyHypothesisPath(id, h.id)}
            hypothesis={h}
            full={full.hypotheses.find((x) => x.id === h.id)!}
            asOf={asOf}
          />
        ))}
      </div>
    </>
  );
}

function WatchPanel({ companyId, onChanged }: { companyId: string; onChanged: () => void }) {
  const { data: watch, reload } = useApi<WatchState>(`/api/companies/${companyId}/watch`);
  const { activeRuns } = usePortfolio();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const collecting = activeRuns.some((run) => run.job === "watch" && run.companyId === companyId);
  const wasCollecting = useRef(false);
  const active = watch?.status === "watching" || watch?.status === "stop-failed";
  const fastPolling = (watch?.status === "starting" && !watch.latestFailure) || collecting;
  usePolling(reload, fastPolling ? 3000 : 30000, fastPolling || active);
  useEffect(() => {
    if (wasCollecting.current && !collecting) reload();
    wasCollecting.current = collecting;
  }, [collecting, reload]);

  const change = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setError(undefined);
    try {
      if (method === "POST") {
        const result = await api<{ watch: WatchState; initialRun: Run }>(`/api/companies/${companyId}/watch`, undefined, method);
        if (result.initialRun) notifyRunsChanged();
      } else {
        await api<WatchState>(`/api/companies/${companyId}/watch`, undefined, method);
      }
      await Promise.all([reload(), onChanged()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const collect = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/runs", { job: "watch", companyId });
      notifyRunsChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!watch) return null;
  return (
    <section className="mt-6 rounded border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-medium">Company monitoring</h2><p className="mt-1 text-sm text-muted-foreground">{active ? "Exa watches for new developments daily. New sources appear in Updates." : "Watch this company for new developments through Exa Monitor."}</p></div>
        <div className="flex flex-wrap gap-2">
          {watch.status === "stopped" && <Button type="button" size="sm" onClick={() => change("POST")} disabled={busy}>Watch this company</Button>}
          {watch.status === "starting" && <Button type="button" size="sm" onClick={() => change("POST")} disabled={busy}>{busy ? "Starting..." : "Retry watch"}</Button>}
          {active && <Button type="button" size="sm" variant="outline" onClick={collect} disabled={busy || collecting}>{collecting ? "Collecting..." : "Collect now"}</Button>}
          {active && <Button type="button" size="sm" variant={watch.status === "stop-failed" ? "destructive" : "ghost"} onClick={() => change("DELETE")} disabled={busy}>{watch.status === "stop-failed" ? "Retry stop" : "Stop watching"}</Button>}
        </div>
      </div>
      {active && <p className="mt-3 text-xs text-muted-foreground">{watch.lastCollectedAt ? `Last checked ${formatDateTime(watch.lastCollectedAt)}` : "Waiting for the first update."} <a href="/updates" className="underline">View updates</a></p>}
      {watch.remoteInspectionFailure && <p className="mt-3 text-sm text-destructive">Remote status check failed {formatDateTime(watch.remoteInspectionFailure.at)}: {watch.remoteInspectionFailure.message}</p>}
      {watch.latestFailure && <p className="mt-3 text-sm text-destructive">Latest failure {formatDateTime(watch.latestFailure.at)}: {watch.latestFailure.message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </section>
  );
}
