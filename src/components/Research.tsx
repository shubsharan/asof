import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Company, Job, Run, RunTarget, Schedule } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePortfolio } from "./usePortfolio";
import { companyHypothesisPath, companyPath } from "./routes";
import {
  api,
  formatConfidence,
  formatDateTime,
  formatDuration,
  JOB_LABELS,
  notifyRunsChanged,
  RunStatusBadge,
  useApi,
  usePolling,
  useRunsChanged,
} from "./shared";

// ---- Targets ----

/** Company and hypothesis names for labelling runs and schedules. */
function useTargets() {
  const { companies, hypotheses } = usePortfolio();
  const label = (t: RunTarget) => ({
    company: companies.find((c) => c.id === t.companyId)?.name ?? t.companyId,
    hypothesis: t.hypothesisId && (hypotheses.find((h) => h.id === t.hypothesisId)?.statement ?? t.hypothesisId),
  });
  return { companies, label };
}

function TargetCell({ target, label }: { target: RunTarget; label: ReturnType<typeof useTargets>["label"] }) {
  const { company, hypothesis } = label(target);
  return (
    <TableCell className="max-w-80">
      <a href={target.hypothesisId ? companyHypothesisPath(target.companyId, target.hypothesisId) : companyPath(target.companyId)} className="block truncate hover:underline">
        <span className="font-medium">{company}</span>
        {hypothesis && <span className="text-muted-foreground"> · {hypothesis}</span>}
      </a>
    </TableCell>
  );
}

const JOB_HINTS: Record<Job, string> = {
  research: "Finds and tags new evidence on the hypothesis with Exa Search. Takes seconds.",
  assess: "Gives a verdict and how confident it is with Exa Agent, which may find more sources. Takes a few minutes and uses Agent credits.",
  watch: "Collects what the company's Exa monitor has found on every hypothesis, starting the monitor on the first run.",
};

const blank = (companyId = ""): RunTarget => ({ job: "research", companyId, hypothesisId: undefined });
const isComplete = (t: RunTarget) => !!t.companyId && (t.job === "watch" || !!t.hypothesisId);

/** Job, company (unless fixed) and hypothesis (except for watch, which covers the whole company). */
function TargetPicker({ value, onChange, company }: { value: RunTarget; onChange: (t: RunTarget) => void; company?: Company }) {
  const { companies, hypotheses } = usePortfolio();

  return (
    <>
      <Select value={value.job} onValueChange={(job: Job) => onChange({ ...value, job, hypothesisId: job === "watch" ? undefined : value.hypothesisId })}>
        <SelectTrigger size="sm" className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(JOB_LABELS) as Job[]).map((j) => (
            <SelectItem key={j} value={j}>
              {JOB_LABELS[j]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!company && (
        <Select value={value.companyId} onValueChange={(companyId) => onChange({ ...value, companyId, hypothesisId: undefined })}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue placeholder="Company" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {value.job !== "watch" && (
        <Select value={value.hypothesisId ?? ""} onValueChange={(hypothesisId) => onChange({ ...value, hypothesisId })} disabled={!value.companyId}>
          <SelectTrigger size="sm" className="w-72">
            <SelectValue placeholder="Hypothesis" />
          </SelectTrigger>
          <SelectContent>
            {hypotheses.map((h) => (
              <SelectItem key={h.id} value={h.id}>
                {h.statement}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  );
}

// ---- Runs ----

/** Starts a manual run. With `company` the company is fixed; `initial` pre-aims the run. */
export function RunNow({ company, initial }: { company?: Company; initial?: RunTarget }) {
  const [target, setTarget] = useState(initial ?? blank(company?.id));
  const [error, setError] = useState<string>();
  const start = async () => {
    setError(undefined);
    try {
      await api<Run>("/api/runs", target);
      notifyRunsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <h2 className="mb-2 font-medium">Run now</h2>
      <div className="flex flex-wrap items-center gap-2">
        <TargetPicker value={target} onChange={setTarget} company={company} />
        <Button size="sm" onClick={start} disabled={!isComplete(target)}>
          Start run
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{JOB_HINTS[target.job]}</p>
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
    </section>
  );
}

const isActive = (r: Run) => r.status === "queued" || r.status === "running";

function RunResultCell({ run }: { run: Run }) {
  if (run.status === "failed") {
    return (
      <TableCell className="max-w-64 truncate text-destructive" title={run.error}>
        {run.error}
      </TableCell>
    );
  }
  const a = run.result?.assessment;
  return (
    <TableCell className="text-muted-foreground">
      {run.result && `+${run.result.evidenceAdded} evidence`}
      {a && ` · ${a.before.verdict} ${formatConfidence(a.before.confidence)} → ${a.after.verdict} ${formatConfidence(a.after.confidence)}`}
    </TableCell>
  );
}

/** Newest first, refreshing while any run is still going. */
export function RunsTable({ companyId }: { companyId?: string }) {
  const { data: runs, reload } = useApi<Run[]>(`/api/runs${companyId ? `?companyId=${companyId}` : ""}`);
  const { label } = useTargets();
  useRunsChanged(reload);
  usePolling(reload, 3000, !!runs?.some(isActive));
  const now = new Date().toISOString();

  return (
    <section>
      <h2 className="mb-2 font-medium">Runs</h2>
      {runs?.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Took</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs?.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{JOB_LABELS[r.job]}</TableCell>
                <TargetCell target={r} label={label} />
                <TableCell className="text-muted-foreground">{r.trigger === "schedule" ? "Scheduled" : "Manual"}</TableCell>
                <TableCell>
                  <RunStatusBadge status={r.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDateTime(r.createdAt)}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{r.startedAt && formatDuration(r.startedAt, r.finishedAt ?? now)}</TableCell>
                <RunResultCell run={r} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// ---- Schedules ----

const INTERVALS: [hours: number, label: string][] = [
  [1, "Every hour"],
  [6, "Every 6 hours"],
  [24, "Daily"],
  [168, "Weekly"],
];

function IntervalSelect({ value, onChange }: { value: number; onChange: (hours: number) => void }) {
  const options = INTERVALS.some(([h]) => h === value) ? INTERVALS : [...INTERVALS, [value, `Every ${value} hours`] as const];
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([h, l]) => (
          <SelectItem key={h} value={String(h)}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** All schedules, or one company's, with a form to add another. */
export function SchedulesTable({ company }: { company?: Company }) {
  const companyId = company?.id;
  const { data: schedules, reload } = useApi<Schedule[]>(`/api/schedules${companyId ? `?companyId=${companyId}` : ""}`);
  const { label } = useTargets();
  const [draft, setDraft] = useState(blank(companyId));
  const [everyHours, setEveryHours] = useState(24);
  const [error, setError] = useState<string>();

  const change = async (s: Schedule, patch: Partial<Pick<Schedule, "enabled" | "everyHours">>) => {
    await api(`/api/schedules/${s.id}`, patch, "PATCH");
    reload();
  };
  const remove = async (s: Schedule) => {
    await api(`/api/schedules/${s.id}`, undefined, "DELETE");
    reload();
  };
  const add = async () => {
    setError(undefined);
    try {
      await api("/api/schedules", { ...draft, everyHours });
      setDraft(blank(companyId));
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <h2 className="mb-2 font-medium">Schedules</h2>
      {schedules?.length === 0 ? (
        <p className="mb-4 text-sm text-muted-foreground">Nothing is scheduled. Runs only happen when started by hand.</p>
      ) : (
        <Table className="mb-4">
          <TableHeader>
            <TableRow>
              <TableHead>Run</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Every</TableHead>
              <TableHead>Next run</TableHead>
              <TableHead>On</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedules?.map((s) => (
              <TableRow key={s.id} className={s.enabled ? undefined : "text-muted-foreground"}>
                <TableCell>{JOB_LABELS[s.job]}</TableCell>
                <TargetCell target={s} label={label} />
                <TableCell>
                  <IntervalSelect value={s.everyHours} onChange={(everyHours) => change(s, { everyHours })} />
                </TableCell>
                <TableCell>{s.enabled ? formatDateTime(s.nextRunAt) : "Paused"}</TableCell>
                <TableCell>
                  <Switch checked={s.enabled} onCheckedChange={(enabled) => change(s, { enabled })} aria-label="Enabled" />
                </TableCell>
                <TableCell className="text-right">
                  <Button size="icon" variant="ghost" onClick={() => remove(s)} aria-label="Delete schedule">
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <TargetPicker value={draft} onChange={setDraft} company={company} />
        <IntervalSelect value={everyHours} onChange={setEveryHours} />
        <Button size="sm" variant="outline" onClick={add} disabled={!isComplete(draft)}>
          Add schedule
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{JOB_HINTS[draft.job]} The first run is one interval from now.</p>
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
    </section>
  );
}
