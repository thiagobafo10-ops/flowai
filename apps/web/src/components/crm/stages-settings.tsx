"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { toast } from "sonner";
import { stageNameSchema } from "@flowai/core";
import {
  createStage,
  deleteStage,
  renameStage,
  reorderStages,
  setStageOutcome,
} from "@/lib/crm/stage-actions";
import type { StageWithCount } from "@/lib/crm/queries";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { selectClassName } from "./contact-dialog";

const OUTCOME_HINT = "Marque outra etapa como Ganho/Perdido antes.";
const LAST_OPEN_HINT = "O pipeline precisa de ao menos uma etapa aberta.";
const dealsLabel = (n: number) => (n === 1 ? "1 deal" : `${n} deals`);

type RowProps = {
  stage: StageWithCount;
  index: number;
  total: number;
  busy: boolean;
  /** Única etapa aberta do pipeline: não pode ser excluída. */
  isLastOpen: boolean;
  onMove: (from: number, to: number) => void;
  onOutcome: (stage: StageWithCount, outcome: "won" | "lost") => void;
  onDelete: (stage: StageWithCount) => void;
  onRenamed: () => void;
};

function StageRow({ stage, index, total, busy, isLastOpen, onMove, onOutcome, onDelete, onRenamed }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: stage.id });
  const [name, setName] = useState(stage.name);
  const [prevName, setPrevName] = useState(stage.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  if (stage.name !== prevName) {
    setPrevName(stage.name);
    setName(stage.name);
  }
  const dirty = name !== stage.name;
  const outcome = stage.isWon || stage.isLost;
  const deleteHint = outcome ? OUTCOME_HINT : isLastOpen ? LAST_OPEN_HINT : null;

  function save() {
    const parsed = stageNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      return;
    }
    setError(null);
    startSave(async () => {
      const result = await renameStage(stage.id, parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Etapa salva.");
      onRenamed();
    });
  }

  const errorId = `stage-${stage.id}-error`;
  return (
    <li
      ref={setNodeRef}
      aria-label={`Etapa ${stage.name}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-xl border bg-card p-3", isDragging && "relative z-10 opacity-80 shadow-lg")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={`Arrastar etapa ${stage.name}`}
          ref={setActivatorNodeRef}
          className="inline-flex size-7 cursor-grab touch-none items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-4" />
        </button>
        <div className="min-w-40 flex-1">
          <Input
            aria-label="Nome da etapa"
            value={name}
            autoComplete="off"
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (dirty) save();
              }
            }}
          />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!dirty || saving} onClick={save}>
          {saving && <Loader2Icon className="animate-spin" />}
          Salvar
        </Button>
        {stage.isWon && (
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            Ganho
          </span>
        )}
        {stage.isLost && (
          <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-400">
            Perdido
          </span>
        )}
        <span className="text-sm text-muted-foreground">{dealsLabel(stage.dealCount)}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUpIcon />
          Subir
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || index === total - 1}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDownIcon />
          Descer
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Ações da etapa ${stage.name}`} />
            }
          >
            <MoreHorizontalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem disabled={stage.isWon || busy} onClick={() => onOutcome(stage, "won")}>
              Marcar como Ganho
            </DropdownMenuItem>
            <DropdownMenuItem disabled={stage.isLost || busy} onClick={() => onOutcome(stage, "lost")}>
              Marcar como Perdido
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={!!deleteHint || busy}
              title={deleteHint ?? undefined}
              onClick={() => onDelete(stage)}
            >
              Excluir etapa
            </DropdownMenuItem>
            {deleteHint && <p className="px-1.5 py-1 text-xs text-muted-foreground">{deleteHint}</p>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

function AddStageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = stageNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createStage(parsed.data);
      if (!result.ok) {
        setError(result.fieldErrors?.name?.[0] ?? result.error);
        return;
      }
      toast.success("Etapa adicionada.");
      setName("");
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setName("");
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar etapa</DialogTitle>
          <DialogDescription>A nova etapa entra antes de Ganho e Perdido.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="new-stage-name">Nome</Label>
            <Input
              id="new-stage-name"
              autoComplete="off"
              value={name}
              aria-invalid={!!error}
              aria-describedby={error ? "new-stage-error" : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {error && (
              <p id="new-stage-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStageDialog({
  stage,
  stages,
  onClose,
}: {
  stage: StageWithCount | null;
  stages: StageWithCount[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = stages.filter((s) => s.id !== stage?.id && !s.isWon && !s.isLost);
  const dealCount = stage?.dealCount ?? 0;
  const hasDeals = dealCount > 0;

  function confirm() {
    if (!stage) return;
    // Sem deals o destino é irrelevante, mas a função exige uma etapa aberta válida.
    const targetId = hasDeals ? target : (options[0]?.id ?? "");
    setError(null);
    startTransition(async () => {
      const result = await deleteStage(stage.id, targetId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Etapa excluída.");
      setTarget("");
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog
      open={!!stage}
      onOpenChange={(o) => {
        if (!o) {
          setTarget("");
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir etapa</DialogTitle>
          <DialogDescription>
            {hasDeals
              ? `Mover ${dealsLabel(dealCount)} para:`
              : `Excluir a etapa ${stage?.name ?? ""}? Esta ação não pode ser desfeita.`}
          </DialogDescription>
        </DialogHeader>
        {hasDeals && (
          <div className="space-y-1.5">
            <Label htmlFor="stage-target">Etapa de destino</Label>
            <select
              id="stage-target"
              className={selectClassName}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value="">Selecione…</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || (hasDeals && !target) || options.length === 0}
            onClick={confirm}
          >
            {pending && <Loader2Icon className="animate-spin" />}
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StagesSettings({ stages }: { stages: StageWithCount[] }) {
  const router = useRouter();
  const [items, setItems] = useState(stages);
  const [prevStages, setPrevStages] = useState(stages);
  if (stages !== prevStages) {
    setPrevStages(stages);
    setItems(stages);
  }
  const [busy, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<StageWithCount | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const prev = items;
    const next = arrayMove(items, from, to);
    setItems(next);
    startTransition(async () => {
      const result = await reorderStages(next.map((s) => s.id));
      if (!result.ok) {
        setItems(prev);
        toast.error(result.error);
      }
      router.refresh();
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((s) => s.id === active.id);
    const to = items.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    move(from, to);
  }

  function onOutcome(stage: StageWithCount, outcome: "won" | "lost") {
    startTransition(async () => {
      const result = await setStageOutcome(stage.id, outcome);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(outcome === "won" ? "Etapa marcada como Ganho." : "Etapa marcada como Perdido.");
      router.refresh();
    });
  }

  const openCount = items.filter((s) => !s.isWon && !s.isLost).length;
  const nameOf = (id: unknown) => items.find((s) => s.id === id)?.name ?? "";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Etapa ${nameOf(active.id)} selecionada.`,
    onDragOver: ({ over }) => (over ? `Sobre a etapa ${nameOf(over.id)}.` : undefined),
    onDragEnd: ({ over }) => (over ? `Etapa solta na posição de ${nameOf(over.id)}.` : "Movimento cancelado."),
    onDragCancel: () => "Movimento cancelado.",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">{items.length === 1 ? "1 etapa" : `${items.length} etapas`}</p>
        <Button type="button" onClick={() => setAdding(true)}>
          <PlusIcon />
          Adicionar etapa
        </Button>
      </div>

      <DndContext
        id="stages-sort"
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Para reordenar, pressione espaço, use as setas para mover e espaço para soltar. Esc cancela.",
          },
        }}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={items.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {items.map((s, i) => (
              <StageRow
                key={s.id}
                stage={s}
                index={i}
                total={items.length}
                busy={busy}
                isLastOpen={!s.isWon && !s.isLost && openCount === 1}
                onMove={move}
                onOutcome={onOutcome}
                onDelete={setDeleting}
                onRenamed={() => router.refresh()}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <AddStageDialog open={adding} onClose={() => setAdding(false)} />
      <DeleteStageDialog stage={deleting} stages={items} onClose={() => setDeleting(null)} />
    </div>
  );
}
