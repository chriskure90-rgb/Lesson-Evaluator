import { Link, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Sparkles, FileCheck2, BookOpen } from "lucide-react";

const items = [
  { to: "/generator", label: "Generator", icon: Sparkles },
  { to: "/evaluator", label: "Evaluator", icon: FileCheck2 },
];

export function AppSidebar() {
  const { pathname } = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-5">
        <Link to="/generator" className="flex items-center gap-2.5 px-1">
          <div className="h-8 w-8 rounded-lg bg-sidebar-primary/90 grid place-items-center shrink-0">
            <BookOpen className="h-4 w-4 text-sidebar-primary-foreground" />
          </div>
          <div className="leading-tight group-data-[collapsible=icon]:hidden">
            <div className="font-display font-medium text-sidebar-foreground text-[15px]">LessonAI</div>
            <div className="text-[11px] text-sidebar-foreground/60">Teacher workspace</div>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = pathname === item.to;
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={item.label}
                      className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-medium"
                    >
                      <Link to={item.to}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 px-1 group-data-[collapsible=icon]:hidden">
          <div className="h-9 w-9 rounded-full bg-sidebar-accent grid place-items-center text-sm font-medium text-sidebar-accent-foreground shrink-0">
            MR
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-[13px] font-medium text-sidebar-foreground truncate">Ms. Rivera</div>
            <div className="text-[11px] text-sidebar-foreground/60 truncate">7th Grade · Science</div>
          </div>
        </div>
        <div className="hidden group-data-[collapsible=icon]:flex justify-center">
          <div className="h-8 w-8 rounded-full bg-sidebar-accent grid place-items-center text-xs font-medium text-sidebar-accent-foreground">MR</div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
