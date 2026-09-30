import { useState, type ReactNode } from "react";
import { sliceDays, type SliceRow } from "@/domain/slices";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SliceChart, SliceLegend } from "./SliceChart";
import { useAsOf } from "./asof";

/** Model research chart with a cutoff local to the chart. */
export function SliceChartCard({ rows, avatar }: { rows: SliceRow[]; avatar?: (rowId: string) => ReactNode }) {
  const { today } = useAsOf();
  const [cutoff, setCutoff] = useState("");
  const days = sliceDays(rows);
  const reconstructed = rows[0]?.mode === "reconstruction";
  if (!rows.length) return null;

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3 text-sm">
        <SliceLegend reconstructed={reconstructed} />
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-muted-foreground">{reconstructed ? "Research cutoff" : "Recorded through"}<input type="date" className="h-8 rounded border bg-background px-2 text-sm text-foreground" value={cutoff} min={days[0]} max={today} onChange={(event) => setCutoff(event.target.value)} /></label>
          {cutoff && <Button type="button" size="sm" variant="ghost" onClick={() => setCutoff("")}>Reset</Button>}
        </div>
      </div>
      <div className="px-4 pt-2 pb-4">
        <SliceChart rows={rows} asOf={cutoff || undefined} today={today} onPickDate={setCutoff} avatar={avatar} />
      </div>
    </Card>
  );
}
