import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { addDays, assessmentDays, calendarTicks, scale, timeDomain } from "@/domain/timeline";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeAsOf, useAsOf } from "./asof";
import { usePortfolio } from "./usePortfolio";
import { formatDate, formatDateTime, formatResearchTime } from "./shared";
import { useWidth } from "./useWidth";

const HEIGHT = 34;
/** The track's baseline, where checkpoint markers and the cursor sit; calendar ticks hang below it. */
const LINE_Y = 12;
/** Minimum px between label anchors. */
const LABEL_GAP = 44;

/**
 * The single time control: the as-of date (a dropdown calendar for any day) and a track marked with
 * the checkpoints (days anything was assessed) over regular week and day ticks. The cursor moves a day
 * at a time: drag or click anywhere, ← → for a day, Shift+← → for the previous or next checkpoint.
 * Every move goes through `setAsOf`, so the whole page follows the cursor while it's dragged.
 */
function useScrubber(companyId?: string, hypothesisId?: string) {
  const { companies, loaded } = usePortfolio();
  const { asOf, setAsOf, mode, today } = useAsOf();
  const scope = useMemo(() => companies.filter((c) => !companyId || c.id === companyId).map((c) => ({ ...c,
    hypotheses: c.hypotheses.filter((h) => !hypothesisId || h.id === hypothesisId),
  })), [companies, companyId, hypothesisId]);
  const domain = useMemo(() => timeDomain(scope, today, mode), [scope, today, mode]);
  const checkpoints = useMemo(() => assessmentDays(scope, today), [scope, today]);
  const cursor = asOf?.slice(0, 10) ?? today;

  const go = (date: string) => setAsOf(normalizeAsOf(date < domain[0] ? domain[0] : date, today));
  const stepDays = (n: number) => go(addDays(cursor, n));
  const jump = (dir: -1 | 1) => {
    const next = dir < 0 ? checkpoints.findLast((d) => d < cursor) : (checkpoints.find((d) => d > cursor) ?? today);
    if (next) go(next);
  };
  return { loaded, asOf, today, domain, checkpoints, cursor, rewound: !!asOf, go, stepDays, jump };
}

type Scrub = ReturnType<typeof useScrubber>;

/** Explicit entry to the recorded history of this page. */
export function HistoryControls({ companyId, hypothesisId }: { companyId?: string; hypothesisId?: string }) {
  const { asOf, setAsOf, mode, setMode, assessmentId } = useAsOf();
  const { rawCompanies } = usePortfolio();
  const [open, setOpen] = useState(false);
  const scrub = useScrubber(companyId, hypothesisId);
  const selected = rawCompanies.find((company) => company.id === companyId)?.hypotheses.find((hypothesis) => hypothesis.id === hypothesisId)?.researchHistory?.find((item) => item.id === assessmentId);
  if (!open && !asOf && assessmentId === undefined && mode === "recorded") return <Button className="mt-4" size="sm" variant="outline" onClick={() => setOpen(true)}>View history</Button>;
  return (
    <section aria-label="Research history" className="mt-4 rounded border border-amber-200 bg-amber-50/50 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{mode === "reconstruction" ? "Reconstructed research" : "Recorded research"}{asOf ? ` · ${mode === "reconstruction" ? "cutoff" : "recorded by"} ${asOf.length > 10 ? formatDateTime(asOf) : formatDate(asOf)}` : ""}</p>
          <p className="text-xs text-muted-foreground">{selected?.origin === "reconstruction" ? `Generated ${selected.recordedAt ? formatResearchTime(selected.recordedAt) : "at an unavailable time"}. ` : ""}{mode === "reconstruction" ? "Retrospective research uses publication cutoffs. Saved page text may have been captured later and does not prove what was known then." : "Browse assessments by when AsOf recorded them."}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setMode("recorded"); setAsOf(undefined); setOpen(false); }}>Back to today</Button>
      </div>
      <label className="mb-3 grid max-w-52 gap-1 text-xs text-muted-foreground">History type
        <select className="h-9 rounded border bg-background px-2 text-sm text-foreground" value={mode} onChange={(event) => setMode(event.target.value === "reconstruction" ? "reconstruction" : "recorded")}>
          <option value="recorded">Recorded research</option>
          <option value="reconstruction">Reconstructions</option>
        </select>
      </label>
      <TimeScrubberCard scrub={scrub} />
    </section>
  );
}

function TimeScrubberCard({ scrub }: { scrub: Scrub }) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between gap-3 px-4 pt-3 text-sm">
        <AsOfPicker scrub={scrub} />
      </div>
      <div className="pt-3 pr-[11px] pb-2 pl-[13px]">
        <Track scrub={scrub} />
      </div>
    </Card>
  );
}

function AsOfPicker({ scrub }: { scrub: Scrub }) {
  const { rewound, cursor, asOf, today, domain, checkpoints, go } = scrub;
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="font-mono text-muted-foreground">As of</span>
      <DatePicker label={rewound ? formatDate(cursor) : "today"} value={asOf?.slice(0, 10)} today={today} start={domain[0]} assessed={checkpoints} onPick={go} />
    </span>
  );
}

/**
 * The draggable track on the shared time axis. It spans whatever width it's given, so a track as wide
 * as the strips below puts its cursor on the same x as theirs. The known past is drawn darker than
 * what came after the cursor, as the strips dim it.
 */
function Track({ scrub }: { scrub: Scrub }) {
  const { loaded, today, domain, checkpoints, cursor, rewound, go, stepDays, jump } = scrub;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [dragging, setDragging] = useState(false);
  const s = scale(domain, width || 1);
  const ticks = useMemo(() => (width > 0 ? calendarTicks(domain, width) : []), [domain, width]);
  const dayAt = (clientX: number, el: HTMLElement) => s.day(clientX - el.getBoundingClientRect().left);
  const cursorX = s.x(cursor);
  const onCheckpoint = checkpoints.includes(cursor);

  // Checkpoints are labeled, and so are today and the cursor; labels that would collide with the
  // cursor's or today's (which always show) or with each other are dropped.
  const candidates = [...checkpoints.filter((d) => d !== today).map((d) => ({ d, text: shortDate(d) })), { d: today, text: "Today" }];
  if (!candidates.some((l) => l.d === cursor)) candidates.push({ d: cursor, text: shortDate(cursor) });
  const pinned = [cursor, today].map(s.x);
  let lastX = -Infinity;
  const labels = candidates
    .map((l) => ({ ...l, x: s.x(l.d) }))
    .sort((a, b) => a.x - b.x)
    .filter(({ x }) => {
      const keep = pinned.includes(x) || (x - lastX >= LABEL_GAP && pinned.every((p) => Math.abs(p - x) >= LABEL_GAP));
      if (keep) lastX = x;
      return keep;
    });

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="As of date"
      aria-valuetext={rewound ? formatDate(cursor) : "Today"}
      aria-valuemin={0}
      aria-valuemax={daysBetween(domain[0], today)}
      aria-valuenow={daysBetween(domain[0], cursor)}
      className="relative min-w-0 cursor-ew-resize touch-none rounded outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{ height: HEIGHT }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        go(dayAt(e.clientX, e.currentTarget));
      }}
      onPointerMove={(e) => {
        if (dragging) go(dayAt(e.clientX, e.currentTarget));
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") e.shiftKey ? jump(-1) : stepDays(-1);
        else if (e.key === "ArrowRight") e.shiftKey ? jump(1) : stepDays(1);
        else if (e.key === "PageUp") stepDays(-7);
        else if (e.key === "PageDown") stepDays(7);
        else if (e.key === "Home") go(checkpoints[0] ?? domain[0]);
        else if (e.key === "End") go(today);
        else return;
        e.preventDefault();
      }}
    >
      {loaded && width > 0 && (
        <svg width={width} height={HEIGHT} className="block overflow-visible">
          {ticks.map((t) => (
            <line key={t.day} x1={t.x} x2={t.x} y1={LINE_Y} y2={LINE_Y + (t.week ? 6 : 3)} className={t.week ? "stroke-muted-foreground/50" : "stroke-muted-foreground/25"} />
          ))}
          <line x1={0} x2={width} y1={LINE_Y} y2={LINE_Y} className="stroke-border" />
          <line x1={0} x2={cursorX} y1={LINE_Y} y2={LINE_Y} className="stroke-muted-foreground/60" />
          {checkpoints.map((d) => (
            <circle key={d} cx={s.x(d)} cy={LINE_Y} r={3.5} className="fill-background stroke-muted-foreground" strokeWidth={1.5}>
              <title>Checkpoint: {formatDate(d)}</title>
            </circle>
          ))}
          <circle cx={cursorX} cy={LINE_Y} r={onCheckpoint ? 5 : 4} className="fill-foreground" />
          <line x1={cursorX} x2={cursorX} y1={0} y2={LINE_Y + 6} className="stroke-foreground" strokeWidth={1} />
          {labels.map(({ d, x, text }) => (
            <text key={d} x={x} y={30} textAnchor={x > width - LABEL_GAP / 2 ? "end" : x < LABEL_GAP / 2 ? "start" : "middle"} className={`font-mono text-[10px] ${d === cursor ? "fill-foreground" : "fill-muted-foreground"}`}>
              {text}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const shortDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// The calendar works in local dates; AsOf works in UTC day strings. Convert at the edge only.
const toLocal = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y!, m! - 1, day!);
};
const fromLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The as-of date as a dropdown: a calendar for any past day, with assessment days marked. */
function DatePicker({
  label,
  value,
  today,
  start,
  assessed,
  onPick,
}: {
  label: string;
  value?: string;
  today: string;
  /** Earliest month worth offering: the start of the time axis. */
  start: string;
  assessed: string[];
  onPick: (date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = toLocal(value ?? today);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 font-mono font-medium tabular-nums" aria-label={`As of ${label}. Pick a date`}>
          {label}
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          captionLayout="dropdown"
          startMonth={toLocal(value && value < start ? value : start)}
          endMonth={toLocal(today)}
          disabled={{ after: toLocal(today) }}
          modifiers={{ assessed: assessed.map(toLocal) }}
          modifiersClassNames={{ assessed: "[&_button]:underline [&_button]:decoration-2 [&_button]:underline-offset-4" }}
          onSelect={(d) => {
            if (!d) return;
            setOpen(false);
            onPick(fromLocal(d));
          }}
        />
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">Underlined days have assessments.</p>
      </PopoverContent>
    </Popover>
  );
}
