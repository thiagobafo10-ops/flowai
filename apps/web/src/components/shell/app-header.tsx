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
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4">
      <MobileNav orgName={orgName} role={role} />
      <p className="flex-1 truncate text-base font-semibold">{title}</p>
      <ThemeToggle />
      <UserMenu userName={userName} userEmail={userEmail} />
    </header>
  );
}
