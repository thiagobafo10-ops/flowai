"use client";

import { ArrowRightLeftIcon } from "lucide-react";
import type { BoardStage } from "@/lib/crm/queries";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  currentStageId: string;
  stages: BoardStage[];
  onMove: (stageId: string) => void;
};

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** Alternativa acessível/móvel ao arrastar: "Mover para…" lista as outras etapas. */
export function MoveMenu({ currentStageId, stages, onMove }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Mover deal"
            onClick={stop}
            onPointerDown={stop}
            onKeyDown={stop}
          />
        }
      >
        <ArrowRightLeftIcon />
      </DropdownMenuTrigger>
      {/* O menu é montado em portal, mas eventos React sobem até o card: não abrir o diálogo. */}
      <DropdownMenuContent align="end" className="w-44" onClick={stop} onPointerDown={stop} onKeyDown={stop}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Mover para…</DropdownMenuLabel>
          {stages
            .filter((s) => s.id !== currentStageId)
            .map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => onMove(s.id)}>
                {s.name}
              </DropdownMenuItem>
            ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
