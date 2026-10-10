"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { toast } from "sonner";
import type { KanbanFilters } from "@flowai/core";
import { moveDeal } from "@/lib/crm/deal-actions";
import type { Board, BoardDeal } from "@/lib/crm/queries";
import { pipelineHref } from "@/lib/crm/url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { selectClassName } from "../contact-dialog";
import { DealDialog, type DealDialogState } from "../deal-dialog";
import { KanbanColumn } from "./column";
import { DealCardBody } from "./deal-card";

const ERROR_MESSAGE = "Não foi possível carregar o pipeline.";

async function fetchBoard(filters: KanbanFilters): Promise<Board> {
  const p = new URLSearchParams();
  if (filters.q) p.set("q", filters.q);
  if (filters.ownerId) p.set("responsavel", filters.ownerId);
  if (filters.closed !== "30d") p.set("encerrados", filters.closed);
  const res = await fetch(`/api/pipeline?${p}`, { cache: "no-store" });
  if (!res.ok) throw new Error(ERROR_MESSAGE);
  return (await res.json()) as Board;
}

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

type Props = {
  orgId: string;
  filters: KanbanFilters;
  initialBoard: Board;
  members: { userId: string; name: string }[];
  canWrite: boolean;
  canDelete: boolean;
  /** Contato pré-selecionado via /pipeline?novo=<id>. */
  novoContact: { id: string; name: string } | null;
};

export function PipelineBoard({ orgId, filters, initialBoard, members, canWrite, canDelete, novoContact }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["board", orgId, filters] as const, [orgId, filters]);

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchBoard(filters),
    initialData: initialBoard,
    staleTime: 30_000,
    retry: false,
  });
  const board = data;

  const firstOpenStage = board.stages.find((s) => !s.isWon && !s.isLost) ?? board.stages[0];
  const novoState = (c: typeof novoContact): DealDialogState | null =>
    c && canWrite && firstOpenStage ? { mode: "create", stageId: firstOpenStage.id, contact: c } : null;

  const [dialog, setDialog] = useState<DealDialogState | null>(() => novoState(novoContact));
  // Nova navegação com outro ?novo= enquanto o quadro já está montado.
  const [seenNovo, setSeenNovo] = useState(novoContact?.id ?? null);
  if ((novoContact?.id ?? null) !== seenNovo) {
    setSeenNovo(novoContact?.id ?? null);
    if (novoContact) setDialog(novoState(novoContact));
  }

  const [activeId, setActiveId] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["board", orgId] });

  const move = useMutation({
    mutationFn: async ({ id, stageId }: { id: string; stageId: string }) => {
      const result = await moveDeal(id, stageId);
      if (!result.ok) throw new Error(result.error);
    },
    onMutate: async ({ id, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ["board", orgId] });
      const previous = queryClient.getQueryData<Board>(queryKey);
      queryClient.setQueryData<Board>(queryKey, (old) =>
        old ? { ...old, deals: old.deals.map((d) => (d.id === id ? { ...d, stageId } : d)) } : old,
      );
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
      toast.error(err.message);
    },
    onSettled: () => {
      void invalidate();
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, BoardDeal[]>();
    for (const d of board.deals) (map.get(d.stageId) ?? map.set(d.stageId, []).get(d.stageId)!).push(d);
    return map;
  }, [board.deals]);

  const requestMove = (dealId: string, stageId: string) => {
    const deal = board.deals.find((d) => d.id === dealId);
    if (!deal || deal.stageId === stageId) return;
    move.mutate({ id: dealId, stageId });
  };

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (e.over) requestMove(String(e.active.id), String(e.over.id));
  }

  function closeDialog() {
    setDialog(null);
    if (novoContact) router.replace(pipelineHref(filters));
  }

  const activeDeal = activeId ? board.deals.find((d) => d.id === activeId) : undefined;
  const hasFilters = !!(filters.q || filters.ownerId || filters.closed !== "30d");

  return (
    <div className="space-y-4">
      <FiltersBar filters={filters} members={members} hasFilters={hasFilters} />
      {isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl p-3 text-sm ring-1 ring-destructive/40">
          <span>{ERROR_MESSAGE}</span>
          <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      <DndContext
        id="pipeline-board"
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {board.stages.map((stage) => (
            <KanbanColumn
              key={stage.id}
              stage={stage}
              stages={board.stages}
              deals={dealsByStage.get(stage.id) ?? []}
              canWrite={canWrite}
              onNew={() => setDialog({ mode: "create", stageId: stage.id, contact: null })}
              onOpen={(deal) => setDialog({ mode: "edit", deal })}
              onMove={requestMove}
            />
          ))}
        </div>
        <DragOverlay>
          {activeDeal ? (
            <div className="w-72 rounded-lg bg-card p-3 shadow-lg ring-1 ring-foreground/20">
              <DealCardBody deal={activeDeal} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <DealDialog
        state={dialog}
        onClose={closeDialog}
        onChanged={() => void invalidate()}
        stages={board.stages}
        members={members}
        canWrite={canWrite}
        canDelete={canDelete}
      />
    </div>
  );
}

function FiltersBar({
  filters,
  members,
  hasFilters,
}: {
  filters: KanbanFilters;
  members: { userId: string; name: string }[];
  hasFilters: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const lastPushed = useRef(filters.q);

  // Busca com atraso.
  useEffect(() => {
    const value = q.trim();
    if (value === filters.q) return;
    const t = setTimeout(() => {
      lastPushed.current = value;
      router.replace(pipelineHref(filters, { q: value }));
    }, 300);
    return () => clearTimeout(t);
  }, [q, filters, router]);

  // URL alterada por fora (ex.: "Limpar filtros"): reflete no campo.
  useEffect(() => {
    if (filters.q !== lastPushed.current) {
      lastPushed.current = filters.q;
      setQ(filters.q);
    }
  }, [filters.q]);

  return (
    <div role="search" className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Buscar deals"
          placeholder="Buscar por contato ou título"
          className="pl-8"
          value={q}
          maxLength={100}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <select
        aria-label="Responsável"
        className={`${selectClassName} w-auto`}
        value={filters.ownerId ?? ""}
        onChange={(e) => router.push(pipelineHref(filters, { ownerId: e.target.value || null }))}
      >
        <option value="">Todos os responsáveis</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Encerrados"
        className={`${selectClassName} w-auto`}
        value={filters.closed}
        onChange={(e) => router.push(pipelineHref(filters, { closed: e.target.value as KanbanFilters["closed"] }))}
      >
        <option value="30d">Encerrados: últimos 30 dias</option>
        <option value="todos">Encerrados: todos</option>
      </select>
      {hasFilters && (
        <Button type="button" variant="ghost" onClick={() => router.push("/pipeline")}>
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
