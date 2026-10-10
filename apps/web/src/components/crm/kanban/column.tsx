"use client";

import { useDroppable } from "@dnd-kit/core";
import { PlusIcon } from "lucide-react";
import { formatBRL } from "@flowai/core";
import type { BoardDeal, BoardStage } from "@/lib/crm/queries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DealCard } from "./deal-card";

type Props = {
  stage: BoardStage;
  stages: BoardStage[];
  deals: BoardDeal[];
  canWrite: boolean;
  onNew: () => void;
  onOpen: (deal: BoardDeal) => void;
  onMove: (dealId: string, stageId: string) => void;
};

export function KanbanColumn({ stage, stages, deals, canWrite, onNew, onOpen, onMove }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled: !canWrite });
  const total = Math.round(deals.reduce((sum, d) => sum + d.value, 0) * 100) / 100;
  const count = deals.length === 1 ? "1 deal" : `${deals.length} deals`;

  return (
    <section
      ref={setNodeRef}
      aria-label={stage.name}
      data-over={isOver}
      className={cn(
        "flex min-h-[26rem] w-72 shrink-0 flex-col gap-3 rounded-xl bg-muted/50 p-3 ring-1 ring-foreground/5",
        isOver && "bg-accent ring-2 ring-ring",
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{stage.name}</h2>
          <p className="text-xs text-muted-foreground">
            {count} · {formatBRL(total)}
          </p>
        </div>
        {canWrite && (
          <Button type="button" variant="ghost" size="sm" onClick={onNew}>
            <PlusIcon />
            Novo deal
          </Button>
        )}
      </header>
      <div className="flex flex-1 flex-col gap-2">
        {deals.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
            Nenhum deal nesta etapa
          </p>
        ) : (
          deals.map((d) => (
            <DealCard
              key={d.id}
              deal={d}
              stages={stages}
              canMove={canWrite}
              onOpen={() => onOpen(d)}
              onMove={(stageId) => onMove(d.id, stageId)}
            />
          ))
        )}
      </div>
    </section>
  );
}
