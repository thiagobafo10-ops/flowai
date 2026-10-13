"use client";

import type { NodeType } from "@flowai/core";
import { NODE_LABEL, PALETTE_TYPES } from "./nodes/labels";

export const PALETTE_MIME = "application/x-flowai-node";

/** Blocos para arrastar ao canvas (ou clicar, para adicionar perto do centro). */
export function Palette({ onAdd }: { onAdd: (type: Exclude<NodeType, "trigger">) => void }) {
  return (
    <nav aria-label="Blocos" className="flex h-full w-48 shrink-0 flex-col gap-1 overflow-y-auto border-r bg-background p-3">
      <p className="px-1 pb-1 text-xs font-medium text-muted-foreground uppercase">Blocos</p>
      {PALETTE_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(PALETTE_MIME, type);
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => onAdd(type)}
          className="cursor-grab rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 active:cursor-grabbing"
        >
          {NODE_LABEL[type]}
        </button>
      ))}
      <p className="px-1 pt-2 text-xs text-muted-foreground">Arraste para o fluxo ou clique para adicionar.</p>
    </nav>
  );
}
