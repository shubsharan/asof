import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api, formatDate } from "./shared";

type Page = { title: string | null; text: string } | null;

/** A cited page as it was on `asOf` (Exa Snapshot) next to how it reads today. */
export function SnapshotDialog({ url, asOf }: { url: string; asOf: string }) {
  const [pages, setPages] = useState<{ then: Page; now: Page }>();
  const [error, setError] = useState<string>();

  const load = (open: boolean) => {
    if (open && !pages) api<{ then: Page; now: Page }>("/api/snapshot", { url, asOf }).then(setPages, (e) => setError(String(e)));
  };

  return (
    <Dialog onOpenChange={load}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 text-xs">
          Page as of {formatDate(asOf)}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="truncate text-sm">{url}</DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!pages && !error && <p className="text-sm text-muted-foreground">Loading both versions…</p>}
        {pages && (
          <div className="grid min-h-0 gap-4 md:grid-cols-2">
            <PageText label={`As of ${formatDate(asOf)} (Exa Snapshot)`} page={pages.then} empty="Exa has no stored version from that date. Snapshot keeps about 5 months of history." />
            <PageText label="Today" page={pages.now} empty="The page couldn't be fetched today." />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PageText({ label, page, empty }: { label: string; page: Page; empty: string }) {
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <h3 className="text-sm font-medium">{label}</h3>
      <div className="max-h-[30vh] overflow-y-auto rounded border p-3 text-xs whitespace-pre-wrap md:max-h-[60vh]">{page ? page.text : empty}</div>
    </div>
  );
}
