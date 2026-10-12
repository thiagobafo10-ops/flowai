"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { findNavItem, NAV_ITEMS } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useInboxRealtime } from "@/components/inbox/realtime-provider";

export function NavLinks({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const activeHref = findNavItem(usePathname())?.href;
  const { unread } = useInboxRealtime();
  return (
    <ul className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-current={item.href === activeHref ? "page" : undefined}
              onClick={onNavigate}
              className={cn(
                "flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                "aria-[current=page]:bg-primary/10 aria-[current=page]:text-primary",
                collapsed && "justify-center px-0",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className={cn(collapsed && "sr-only")}>{item.label}</span>
              {item.href === "/inbox" && unread > 0 && (
                <span aria-label={`${unread} conversas não lidas`} className={cn("ml-auto rounded-full bg-primary px-1.5 text-xs text-primary-foreground", collapsed && "sr-only")}>
                  {unread}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
