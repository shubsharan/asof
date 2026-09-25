import { useCallback, useState } from "react";
import type { RunTarget } from "@/domain/types";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePortfolio } from "./usePortfolio";
import { RunNow, RunsTable } from "./Research";
import { useResearchRequests } from "./shared";

/** Runs and schedules, in a panel over whatever you were looking at. Opened by the header button or `openResearch()`. */
export function ResearchSheet() {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<RunTarget>();
  const { companies } = usePortfolio();
  useResearchRequests(
    useCallback((target?: RunTarget) => {
      setInitial(target);
      setOpen(true);
    }, []),
  );
  const company = companies.find((c) => c.id === initial?.companyId);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Research</SheetTitle>
          <SheetDescription>Start an Exa search, agent run or monitor pull, and follow the ones in flight.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-8 px-4 pb-6">
          <RunNow key={`${initial?.companyId}-${initial?.hypothesisId}`} company={company} initial={initial} />
          <RunsTable companyId={company?.id} />
          <p className="text-sm text-muted-foreground">
            To run research automatically, add a schedule in{" "}
            <a href="/settings" className="underline">
              Settings
            </a>
            .
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
