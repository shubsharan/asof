import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { assessmentDays, scale, timeDomain } from "@/domain/timeline";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeAsOf, useAsOf } from "./asof";
import { usePortfolio } from "./usePortfolio";
import { formatDate } from "./shared";
import { useWidth } from "./useWidth";

const SNAP_PX = 8;
const HEIGHT = 34;
// One row on wide screens; on phones the track wraps onto its own line under the date.
const ROW = "flex-wrap gap-x-3 py-1 sm:h-12 sm:flex-nowrap sm:py-0";

/**
 * The single time control, one row: the as-of date (a dropdown calendar for any day), then a track
 * with dots on the days anything was assessed and a cursor you drag, click, or step with ← →.
 * The date is committed to the URL on release, so scrubbing is free and links keep the rewound date.
 */
export function TimeScrubber({ leading }: { leading?: ReactNode }) {
  const { companies, loaded } = usePortfolio();
  const { asOf, setAsOf, today } = useAsOf();
  const [ref, width] = useWidth<HTMLDivElement>();
  const domain = useMemo(() => timeDomain(companies, today), [companies, today]);
  const days = useMemo(() => assessmentDays(companies, today), [companies, today]);
  const stops = useMemo(() => [...days, today], [days, today]);
  const s = scale(domain, width || 1);

  const [draft, setDraft] = useState<string | null>(null); // the cursor while dragging
  const cursor = draft ?? asOf ?? today;
  const rewound = cursor !== today;

  const dayAt = (clientX: number, el: HTMLElement) => {
    const x = clientX - el.getBoundingClientRect().left;
    const snapped = stops.find((d) => Math.abs(s.x(d) - x) <= SNAP_PX);
    return snapped ?? s.day(x);
  };
  const commit = (date: string) => {
    setDraft(null);
    setAsOf(normalizeAsOf(date, today));
  };
  const step = (delta: number) => {
    const i = stops.indexOf(asOf ?? today);
    const at = i === -1 ? stops.findIndex((d) => d > (asOf ?? today)) + (delta < 0 ? -1 : 0) : i + delta;
    const next = stops[Math.max(0, Math.min(stops.length - 1, at))];
    if (next) commit(next);
  };

  return (
    <div className={`flex ${ROW} items-center text-sm`}>
      {leading && <span className="flex shrink-0 items-center gap-2">{leading}</span>}
      <span className="flex shrink-0 items-center gap-1">
        <span className="font-mono text-muted-foreground">As of</span>
        <DatePicker label={rewound ? formatDate(cursor) : "today"} value={asOf} today={today} start={domain[0]} assessed={days} onPick={commit} />
      </span>

      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="As of date"
        aria-valuetext={rewound ? formatDate(cursor) : "Today"}
        aria-valuemin={0}
        aria-valuemax={stops.length - 1}
        aria-valuenow={Math.max(0, stops.indexOf(asOf ?? today))}
        className="relative order-last min-w-0 basis-full cursor-ew-resize sm:order-none sm:basis-0 sm:flex-1 sm:translate-y-1 touch-none outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
        style={{ height: HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDraft(dayAt(e.clientX, e.currentTarget));
        }}
        onPointerMove={(e) => {
          if (draft !== null) setDraft(dayAt(e.clientX, e.currentTarget));
        }}
        onPointerUp={(e) => commit(dayAt(e.clientX, e.currentTarget))}
        onPointerCancel={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") step(-1);
          else if (e.key === "ArrowRight") step(1);
          else if (e.key === "Home") commit(stops[0]!);
          else if (e.key === "End") commit(today);
          else return;
          e.preventDefault();
        }}
      >
        {loaded && width > 0 && (
          <svg width={width} height={HEIGHT} className="block overflow-visible">
            <line x1={0} x2={width} y1={12} y2={12} className="stroke-border" />
            {stops.map((d) => {
              const x = s.x(d);
              const isToday = d === today;
              const active = d === cursor;
              return (
                <g key={d}>
                  <circle cx={x} cy={12} r={active ? 5 : 3.5} className={active ? "fill-foreground" : "fill-background stroke-muted-foreground"} strokeWidth={1.5} />
                  <text x={x} y={30} textAnchor={isToday ? "end" : d === stops[0] ? "start" : "middle"} className={`font-mono text-[10px] ${active ? "fill-foreground" : "fill-muted-foreground"}`}>
                    {isToday ? "Today" : shortDate(d)}
                  </text>
                </g>
              );
            })}
            {!stops.includes(cursor) && <circle cx={s.x(cursor)} cy={12} r={5} className="fill-foreground" />}
            <line x1={s.x(cursor)} x2={s.x(cursor)} y1={0} y2={18} className="stroke-foreground" strokeWidth={1} />
          </svg>
        )}
      </div>

      {/* Reserve the space so the track doesn't jump when the button appears. */}
      <Button variant={asOf ? "default" : "ghost"} size="sm" className={`ml-auto h-7 shrink-0 px-2.5 text-xs sm:ml-0 ${asOf ? "" : "invisible"}`} onClick={() => commit(today)} tabIndex={asOf ? 0 : -1}>
        Back to today
      </Button>
    </div>
  );
}

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
