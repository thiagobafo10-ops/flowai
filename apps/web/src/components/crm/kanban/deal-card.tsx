"use client";

import { useDraggable } from "@dnd-kit/core";
import { formatBRL } from "@flowai/core";
import { initials } from "@/lib/crm/format";
import type { BoardDeal, BoardStage } from "@/lib/crm/queries";
import { cn } from "@/lib/utils";
import { MoveMenu } from "./move-menu";

type CardProps = {
  deal: BoardDeal;
  stages: BoardStage[];
  /** Agente+ pode arrastar e mover; visualizador só abre. */
  canMove: boolean;
  onOpen: () => void;
  onMove: (stageId: string) => void;
};

/** Conteúdo visual do card (também usado no DragOverlay). */
export function DealCardBody({ deal, menu }: { deal: BoardDeal; menu?: React.ReactNode }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{deal.contact.name}</p>
        {menu}
      </div>
      <button type="button" className="block w-full text-left text-sm text-muted-foreground hover:underline">
        {deal.title}
      </button>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{formatBRL(deal.value)}</span>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
            Score {deal.contact.leadScore}
          </span>
          {deal.ownerName && (
            <span
              title={deal.ownerName}
              aria-label={`Responsável: ${deal.ownerName}`}
              className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary"
            >
              {initials(deal.ownerName)}
            </span>
          )}
        </span>
      </div>
    </>
  );
}

export function DealCard({ deal, stages, canMove, onOpen, onMove }: CardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: !canMove,
  });
  return (
    <div
      ref={setNodeRef}
      {...(canMove ? attributes : {})}
      {...(canMove ? listeners : {})}
      // Os atributos do dnd-kit trazem role="button"; o card contém botões, então é um grupo.
      role="group"
      tabIndex={0}
      aria-label={deal.title}
      onClick={onOpen}
      className={cn(
        "cursor-pointer rounded-lg bg-card p-3 text-card-foreground shadow-xs ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        canMove && "touch-manipulation",
        isDragging && "opacity-40",
      )}
    >
      <DealCardBody
        deal={deal}
        menu={
          canMove ? <MoveMenu currentStageId={deal.stageId} stages={stages} onMove={onMove} /> : undefined
        }
      />
    </div>
  );
}
