"use client";

import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useState } from "react";
import type { OrgRole } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { NavLinks } from "./nav-links";

import { SIDEBAR_COOKIE } from "@/lib/sidebar-cookie";
const ONE_YEAR = 60 * 60 * 24 * 365;

export function AppSidebar({
  orgName,
  role,
  initialCollapsed,
}: {
  orgName: string;
  role: OrgRole;
  initialCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  }

  return (
    <aside
      aria-label="Navegação principal"
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className={cn("flex h-14 items-center border-b px-4", collapsed && "justify-center px-0")}>
        <span className="text-lg font-semibold tracking-tight">{collapsed ? "F" : "FlowAI"}</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        <NavLinks collapsed={collapsed} />
      </nav>
      <div className={cn("flex items-center gap-2 border-t p-3", collapsed && "justify-center")}>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{orgName}</p>
            <p className="truncate text-xs text-muted-foreground">{roleLabel(role)}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
        </Button>
      </div>
    </aside>
  );
}
