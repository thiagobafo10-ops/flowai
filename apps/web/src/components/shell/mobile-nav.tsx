"use client";

import { AsteriskIcon, MenuIcon } from "lucide-react";
import { useState } from "react";
import type { OrgRole } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { IconOrb } from "@/components/ui/icon-orb";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { roleLabel } from "@/lib/navigation";
import { NavLinks } from "./nav-links";

export function MobileNav({ orgName, role }: { orgName: string; role: OrgRole }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full lg:hidden"
            aria-label="Abrir menu"
          />
        }
      >
        <MenuIcon />
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-72 gap-0 bg-background p-3">
        <div className="flex h-full flex-col overflow-hidden rounded-[28px] bg-card shadow-float">
          <div className="flex h-16 items-center gap-3 px-4">
            <IconOrb size="md" aria-hidden="true">
              <AsteriskIcon className="size-4" />
            </IconOrb>
            <SheetTitle className="text-base font-semibold tracking-tight">FlowAI</SheetTitle>
            <SheetDescription className="sr-only">Navegação principal</SheetDescription>
          </div>
          <nav aria-label="Módulos" className="flex-1 overflow-y-auto px-2 pb-2">
            <NavLinks onNavigate={() => setOpen(false)} />
          </nav>
          <div className="px-4 pb-4">
            <p className="truncate text-sm font-medium">{orgName}</p>
            <p className="truncate text-xs text-muted-foreground">{roleLabel(role)}</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
