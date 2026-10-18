"use client";

import { LogOutIcon, UserIcon } from "lucide-react";
import { useTransition } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { IconOrb } from "@/components/ui/icon-orb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({ userName, userEmail }: { userName: string; userEmail: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            aria-label="Menu do usuário"
            className="h-9 gap-2 rounded-full pr-3 pl-1"
          />
        }
      >
        <IconOrb size="sm" tone="muted" aria-hidden="true">
          <UserIcon />
        </IconOrb>
        <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
          {userName || userEmail}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2 py-1.5">
          {userName && <p className="truncate text-sm font-medium">{userName}</p>}
          <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pending} onClick={() => startTransition(() => signOut())}>
          <LogOutIcon />
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
