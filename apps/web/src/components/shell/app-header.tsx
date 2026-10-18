"use client";

import { usePathname } from "next/navigation";
import type { OrgRole } from "@flowai/core";
import { findNavItem } from "@/lib/navigation";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function AppHeader({
  orgName,
  role,
  userName,
  userEmail,
}: {
  orgName: string;
  role: OrgRole;
  userName: string;
  userEmail: string;
}) {
  const title = findNavItem(usePathname())?.label ?? "";
  return (
    <header className="sticky top-0 z-30 bg-background/80 px-3 pt-3 pb-2 backdrop-blur">
      <div className="flex h-12 items-center gap-1 rounded-full bg-card px-2 text-card-foreground shadow-float">
        <MobileNav orgName={orgName} role={role} />
        <p className="flex-1 truncate px-2 text-sm font-medium">{title}</p>
        <ThemeToggle />
        <UserMenu userName={userName} userEmail={userEmail} />
      </div>
    </header>
  );
}
