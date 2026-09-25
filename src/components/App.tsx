import type { Run } from "@/domain/types";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { Company } from "./Company";
import { Hypotheses } from "./Hypotheses";
import { HypothesisDetail } from "./HypothesisDetail";
import { Matrix } from "./Matrix";
import { ResearchSheet } from "./ResearchSheet";
import { parseRoute, type Route } from "./routes";
import { Settings } from "./Settings";
import { useApi, usePolling, useRunsChanged } from "./shared";
import { TimeScrubber } from "./TimeScrubber";
import { Updates } from "./Updates";
import { PortfolioProvider } from "./usePortfolio";

export function App() {
  return (
    <PortfolioProvider>
      <Shell />
    </PortfolioProvider>
  );
}

function Shell() {
  const route = parseRoute(location.pathname);
  const { data: activeRuns, reload: reloadRuns } = useApi<Run[]>("/api/runs?active=1");
  usePolling(reloadRuns, 5000, !!activeRuns?.length);
  useRunsChanged(reloadRuns);

  return (
    // Every link is a full page load, so restore the collapsed state the sidebar saved in its cookie.
    <SidebarProvider defaultOpen={!document.cookie.includes("sidebar_state=false")}>
      <AppSidebar route={route} activeRuns={activeRuns?.length ?? 0} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
          <div className="mx-auto w-full max-w-6xl px-6">
            <TimeScrubber
              leading={
                <>
                  <SidebarTrigger className="-ml-1" />
                  <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
                </>
              }
            />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl p-6">
          <Page route={route} activeRuns={activeRuns ?? []} />
        </main>
      </SidebarInset>
      <ResearchSheet />
    </SidebarProvider>
  );
}

function Page({ route, activeRuns }: { route: Route; activeRuns: Run[] }) {
  switch (route.page) {
    case "portfolio":
      return <Matrix activeRuns={activeRuns} />;
    case "hypotheses":
      return <Hypotheses lens={route.lens} />;
    case "updates":
      return <Updates />;
    case "settings":
      return <Settings />;
    case "company":
      return <Company id={route.companyId} />;
    case "hypothesis":
      return <HypothesisDetail companyId={route.companyId} hypothesisId={route.hypothesisId} />;
    case "not-found":
      return <p>Not found.</p>;
  }
}
