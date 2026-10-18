"use client";

import { AsteriskIcon, PanelLeftCloseIcon, PanelLeftOpenIcon } from "lucide-react";
import { useState } from "react";
import type { OrgRole } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { IconOrb } from "@/components/ui/icon-orb";
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
        "sticky top-0 hidden h-screen shrink-0 flex-col p-3 lg:flex",
        collapsed ? "w-[4.75rem]" : "w-64",
      )}
    >
      <div className="flex h-full flex-col overflow-hidden rounded-[28px] bg-card text-card-foreground shadow-float">
        <div className={cn("flex h-16 items-center gap-3 px-4", collapsed && "justify-center px-0")}>
          <IconOrb size="md" aria-hidden="true">
            <AsteriskIcon className="size-4" />
          </IconOrb>
          {!collapsed && <span className="text-base font-semibold tracking-tight">FlowAI</span>}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          <NavLinks collapsed={collapsed} />
        </nav>
        <div className={cn("flex items-center gap-2 px-3 pb-3", collapsed && "flex-col px-0")}>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{orgName}</p>
              <p className="truncate text-xs text-muted-foreground">{roleLabel(role)}</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={toggle}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
          </Button>
        </div>
      </div>
    </aside>
  );
}
