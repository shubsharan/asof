import { useMemo } from "react";
import { FlaskConical, Inbox, LayoutGrid, Settings, Target } from "lucide-react";
import { lensesOf } from "@/domain/timeline";
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
import { companyPath, lensPath, type Route } from "./routes";
import { openResearch, withAsOf } from "./shared";
import { usePortfolio } from "./usePortfolio";

/** Portfolio (with its companies), Hypotheses (with the lenses), Updates, Settings; Research opens as a panel. */
export function AppSidebar({ route, activeRuns }: { route: Route; activeRuns: number }) {
  const { companies } = usePortfolio();
  const { asOf } = useAsOf();
  const lenses = useMemo(() => lensesOf(companies), [companies]);
  const companyId = "companyId" in route ? route.companyId : undefined;
  const lens = route.page === "hypotheses" ? route.lens : undefined;
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
              <SidebarMenuButton asChild tooltip="Portfolio" isActive={route.page === "portfolio" || !!companyId}>
                <a href={link("/")}>
                  <LayoutGrid />
                  <span>Portfolio</span>
                </a>
              </SidebarMenuButton>
              <SidebarMenuSub>
                {companies.map((c) => (
                  <SidebarMenuSubItem key={c.id}>
                    <SidebarMenuSubButton asChild isActive={c.id === companyId}>
                      <a href={link(companyPath(c.id))}>{c.name}</a>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            </SidebarMenuItem>

            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Hypotheses" isActive={route.page === "hypotheses"}>
                <a href={link("/hypotheses")}>
                  <Target />
                  <span>Hypotheses</span>
                </a>
              </SidebarMenuButton>
              <SidebarMenuSub>
                {lenses.map((l) => (
                  <SidebarMenuSubItem key={l.key}>
                    <SidebarMenuSubButton asChild isActive={l.key === lens}>
                      <a href={link(lensPath(l.key))} title={l.statement}>
                        <span className="truncate">{l.statement}</span>
                      </a>
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
            <SidebarMenuButton tooltip="Research" onClick={() => openResearch()}>
              <FlaskConical />
              <span>Research</span>
            </SidebarMenuButton>
            {activeRuns > 0 && <SidebarMenuBadge className="bg-sky-100 font-mono text-sky-800">{activeRuns}</SidebarMenuBadge>}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
