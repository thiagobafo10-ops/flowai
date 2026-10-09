"use client";

import { MenuIcon } from "lucide-react";
import { useState } from "react";
import type { OrgRole } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { roleLabel } from "@/lib/navigation";
import { NavLinks } from "./nav-links";

export function MobileNav({ orgName, role }: { orgName: string; role: OrgRole }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menu" />}
      >
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-64 gap-0 p-0">
        <div className="flex h-14 items-center border-b px-4">
          <SheetTitle className="text-lg font-semibold tracking-tight">FlowAI</SheetTitle>
          <SheetDescription className="sr-only">Navegação principal</SheetDescription>
        </div>
        <nav aria-label="Módulos" className="flex-1 overflow-y-auto p-3">
          <NavLinks onNavigate={() => setOpen(false)} />
        </nav>
        <div className="border-t p-3">
          <p className="truncate text-sm font-medium">{orgName}</p>
          <p className="truncate text-xs text-muted-foreground">{roleLabel(role)}</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
