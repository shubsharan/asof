import { FlaskConical, Inbox, LayoutGrid, Settings } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useAsOf } from "./asof";
import { companyPath, type Route } from "./routes";
import { openResearch, withAsOf } from "./shared";
import { usePortfolio } from "./usePortfolio";

/** Portfolio (with its companies), Updates, Settings; Runs opens as a panel. Hypotheses live on the Portfolio cards. */
export function AppSidebar({ route, activeRuns }: { route: Route; activeRuns: number }) {
  const { companies } = usePortfolio();
  const { asOf } = useAsOf();
  const companyId = "companyId" in route ? route.companyId : undefined;
  const link = (path: string) => withAsOf(path, asOf);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href={link("/")}>
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary font-mono text-sm text-primary-foreground">A</span>
                <span className="font-semibold">AsOf</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Portfolio" isActive={route.page === "portfolio" || route.page === "hypotheses" || !!companyId}>
                <a href={link("/")}>
                  <LayoutGrid />
                  <span>Portfolio</span>
                </a>
              </SidebarMenuButton>
              <SidebarMenuSub>
                {companies.map((c) => (
                  <SidebarMenuSubItem key={c.id}>
                    <SidebarMenuSubButton asChild isActive={c.id === companyId} className={c.hypotheses.some((h) => h.history.length) ? undefined : "text-muted-foreground"}>
                      <a href={link(companyPath(c.id))}>{c.name}</a>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Updates" isActive={route.page === "updates"}>
                <a href={link("/updates")}>
                  <Inbox />
                  <span>Updates</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Settings" isActive={route.page === "settings"}>
                <a href={link("/settings")}>
                  <Settings />
                  <span>Settings</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Runs" onClick={() => openResearch()}>
              <FlaskConical />
              <span>Runs</span>
            </SidebarMenuButton>
            {activeRuns > 0 && <SidebarMenuBadge className="bg-sky-100 font-mono text-sky-800">{activeRuns}</SidebarMenuBadge>}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
