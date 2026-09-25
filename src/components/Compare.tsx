import { compareThesis } from "@/domain/thesis";
import type { Company, Hypothesis } from "@/domain/types";
import { companyHypothesisPath } from "./routes";
import { DIRECTION, formatConfidence, formatDate, VerdictBadge, withAsOf } from "./shared";

/**
 * The README's "Compare with today" table: what the thesis looked like on the as-of date beside what
 * it looks like now. Only rendered while rewound, because at today both columns would be the same.
 */

const count = (h: Hypothesis, type: string) => h.evidence.filter((e) => e.type === type).length;

function Verdict({ h }: { h: Pick<Hypothesis, "verdict" | "confidence"> }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono tabular-nums">
      <VerdictBadge verdict={h.verdict} />
      <span className="text-base font-semibold">{formatConfidence(h.confidence)}</span>
    </span>
  );
}

const TH = "py-2 text-left text-xs font-medium text-muted-foreground";
const TD = "border-t py-2.5 align-middle";

/** Every lens of one company, then vs now. */
export function CompanyCompare({ view, full, asOf }: { view: Company; full: Company; asOf: string }) {
  const changes = compareThesis(view, full);
  return (
    <section className="overflow-x-auto rounded-lg border px-4 pt-2 pb-3">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr>
            <th className={TH}>Compared with today</th>
            <th className={`${TH} w-40`}>{formatDate(asOf)}</th>
            <th className={`${TH} w-40`}>Today</th>
            <th className={`${TH} w-32 text-right`}>New since</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => {
            const moved = c.before.confidence !== c.after.confidence || c.before.verdict !== c.after.verdict;
            return (
              <tr key={c.id} className={moved ? undefined : "text-muted-foreground"}>
                <td className={`${TD} pr-4`}>
                  <a href={withAsOf(companyHypothesisPath(view.id, c.id), asOf)} className="hover:underline">
                    {c.statement}
                  </a>
                </td>
                <td className={TD}>
                  <Verdict h={c.before} />
                </td>
                <td className={TD}>
                  <Verdict h={c.after} />
                </td>
                <td className={`${TD} text-right font-mono text-xs text-muted-foreground tabular-nums`}>
                  {c.newEvidence.length ? `+${c.newEvidence.length} evidence` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** One hypothesis, then vs now, on the facts the reader would ask about first. */
export function HypothesisCompare({ view, full, asOf }: { view: Hypothesis; full: Hypothesis; asOf: string }) {
  const latest = (h: Hypothesis) => h.history.at(-1);
  const rows: [label: string, then: React.ReactNode, now: React.ReactNode, tone?: string][] = [
    ["Verdict", <Verdict key="t" h={view} />, <Verdict key="n" h={full} />],
    ["Evidence known", view.evidence.length, full.evidence.length],
    ["Supporting", count(view, "supports"), count(full, "supports"), DIRECTION.supports.text],
    ["Contradicting", count(view, "contradicts"), count(full, "contradicts"), DIRECTION.contradicts.text],
    ["Assessments", view.history.length, full.history.length],
    ["Open questions", latest(view)?.openQuestions.length ?? "—", latest(full)?.openQuestions.length ?? "—"],
  ];
  return (
    <section className="overflow-x-auto rounded-lg border px-4 pt-2 pb-3">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr>
            <th className={TH}>Compared with today</th>
            <th className={`${TH} w-40`}>{formatDate(asOf)}</th>
            <th className={`${TH} w-40`}>Today</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, then, now, tone]) => (
            <tr key={label}>
              <td className={`${TD} text-muted-foreground`}>{label}</td>
              <td className={`${TD} font-mono tabular-nums ${tone ?? ""}`}>{then}</td>
              <td className={`${TD} font-mono tabular-nums ${tone ?? ""}`}>{now}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
