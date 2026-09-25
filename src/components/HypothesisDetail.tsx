import { useState } from "react";
import type { Evidence } from "@/domain/types";
import { Button } from "@/components/ui/button";
import { SnapshotDialog } from "./SnapshotDialog";
import { api, EvidenceRow, formatDate, StatusBadge, useCompany } from "./shared";

export function HypothesisDetail({ companyId, hypothesisId, asOf }: { companyId: string; hypothesisId: string; asOf?: string }) {
  const { company, reload } = useCompany(companyId, asOf);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();

  const h = company?.hypotheses.find((x) => x.id === hypothesisId);
  if (!company || !h) return null;
  const latest = h.history.at(-1);
  const previous = h.history.at(-2);
  const cited = new Set(latest?.evidenceIds);
  // Page snapshots only make sense for a past date.
  const snapshot = (e: Evidence) => asOf && <SnapshotDialog url={e.url} asOf={asOf} />;

  const runDiligence = async () => {
    setRunning(true);
    setError(undefined);
    try {
      await api("/api/research/agent", { companyId, hypothesisId });
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <a href={`/c/${companyId}${asOf ? `?asOf=${asOf}` : ""}`} className="text-sm text-muted-foreground">
        ← {company.name}
        {asOf && ` as of ${formatDate(asOf)}`}
      </a>
      <h1 className="mt-2 text-2xl font-semibold">{h.statement}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-3xl font-semibold tabular-nums">
          {previous && <span className="text-muted-foreground">{previous.confidence}% → </span>}
          {h.confidence === undefined ? "Untested" : `${h.confidence}%`}
        </span>
        <StatusBadge status={h.status} />
        {!asOf && (
          <Button className="ml-auto" onClick={runDiligence} disabled={running}>
            {running ? "Exa Agent is researching (a few minutes)…" : "Run deeper diligence"}
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {latest && (
        <div className="mt-6 grid gap-6 md:grid-cols-[3fr_2fr]">
          <section>
            <h2 className="mb-2 font-medium">Why, as of {formatDate(latest.asOf)}</h2>
            <p className="text-sm leading-relaxed whitespace-pre-line">{latest.reasoning.replaceAll("**", "") /* the Agent sometimes writes Markdown bold */}</p>
          </section>
          <section>
            <h2 className="mb-2 font-medium">Remaining concerns</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {latest.openQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
            <h2 className="mt-6 mb-2 font-medium">History</h2>
            <ul className="space-y-1 text-sm">
              {h.history.map((v) => (
                <li key={v.asOf} className="flex items-center gap-2">
                  <span className="w-28 text-muted-foreground">{formatDate(v.asOf)}</span>
                  <span className="w-10 tabular-nums">{v.confidence}%</span>
                  <StatusBadge status={v.status} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <EvidenceSection title="Cited in this assessment" evidence={h.evidence.filter((e) => cited.has(e.id))} action={snapshot} />
      <EvidenceSection title="Other evidence" evidence={h.evidence.filter((e) => !cited.has(e.id))} action={snapshot} />
    </>
  );
}

function EvidenceSection({ title, evidence, action }: { title: string; evidence: Evidence[]; action: (e: Evidence) => React.ReactNode }) {
  if (!evidence.length) return null;
  return (
    <section className="mt-8">
      <h2 className="font-medium">
        {title} <span className="text-muted-foreground">({evidence.length})</span>
      </h2>
      <ul className="divide-y">
        {[...evidence].reverse().map((e) => (
          <EvidenceRow key={e.id} evidence={e} action={action(e)} />
        ))}
      </ul>
    </section>
  );
}
