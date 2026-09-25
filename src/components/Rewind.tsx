import { compareThesis } from "@/domain/thesis";
import type { Company } from "@/domain/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, StatusBadge } from "./shared";

/** One point per day the thesis was assessed, plus today. Clicking a point rewinds to that day. */
export function Timeline({ today, asOf, basePath }: { today: Company; asOf?: string; basePath: string }) {
  const todayDay = new Date().toISOString().slice(0, 10); // assessments are stamped in UTC
  const days = [...new Set(today.hypotheses.flatMap((h) => h.history.map((v) => v.asOf.slice(0, 10))))]
    .filter((d) => d < todayDay) // today's assessments are the "Today" point
    .sort();
  const points = [...days.map((d) => ({ label: formatDate(d), asOf: d as string | undefined })), { label: "Today", asOf: undefined }];

  return (
    <div className="relative flex justify-between px-2 py-6">
      <div className="absolute top-[34px] right-6 left-6 h-px bg-border" />
      {points.map((p) => {
        const selected = p.asOf === asOf || (!asOf && !p.asOf);
        return (
          <a
            key={p.label}
            href={p.asOf ? `${basePath}?asOf=${p.asOf}` : basePath}
            className="relative flex flex-col items-center gap-2 text-xs"
          >
            <span className={`size-4 rounded-full border-2 ${selected ? "border-primary bg-primary" : "border-border bg-background"}`} />
            <span className={selected ? "font-semibold" : "text-muted-foreground"}>{p.label}</span>
          </a>
        );
      })}
    </div>
  );
}

const confidence = (c?: number) => (c === undefined ? "—" : `${c}%`);

/** The thesis on the rewound date next to today's, per hypothesis. */
export function CompareWithToday({ then, today, asOf }: { then: Company; today: Company; asOf: string }) {
  const changes = compareThesis(then, today);
  const evidenceCount = (c: Company) => c.hypotheses.reduce((n, h) => n + h.evidence.length, 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead className="text-right">{formatDate(asOf)}</TableHead>
          <TableHead className="text-right">Today</TableHead>
          <TableHead className="text-right">New since</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {changes.map((c) => (
          <TableRow key={c.id}>
            <TableCell>{c.statement}</TableCell>
            <TableCell className="text-right">
              {confidence(c.before.confidence)} <StatusBadge status={c.before.status} />
            </TableCell>
            <TableCell className="text-right">
              {confidence(c.after.confidence)} <StatusBadge status={c.after.status} />
            </TableCell>
            <TableCell className="text-right">{c.newEvidence.length}</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell className="font-medium">Evidence available</TableCell>
          <TableCell className="text-right">{evidenceCount(then)} items</TableCell>
          <TableCell className="text-right">{evidenceCount(today)} items</TableCell>
          <TableCell />
        </TableRow>
      </TableBody>
    </Table>
  );
}
