"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ClockIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { WEEKDAY_LABEL } from "@/lib/automation/node-labels";
import { saveSequence, setSequenceStatus } from "@/lib/growth/actions";
import { type DelayUnit, delayToMinutes, minutesToDelay } from "@/lib/growth/delay";
import type {
  GrowthChannel,
  SequenceDetail,
} from "@/lib/growth/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OutreachMessageForm } from "./outreach-message-form";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function SequenceEditor({
  sequence,
  channels,
  activeAutomations,
  canWrite,
}: {
  sequence: SequenceDetail;
  channels: GrowthChannel[];
  activeAutomations: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(sequence.name);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(
    sequence.settings.channelIds || [channels[0]?.id || ""],
  );
  const [exitOnReply, setExitOnReply] = useState(sequence.settings.exitOnReply || false);
  const [exitWordsText, setExitWordsText] = useState(
    (sequence.settings.exitWords || ["sair", "parar", "cancelar"]).join(", "),
  );

  const [steps, setSteps] = useState(sequence.steps || []);
  const [status, setStatus] = useState(sequence.status);
  const [hasChanges, setHasChanges] = useState(false);

  function markChanged() {
    if (!hasChanges) setHasChanges(true);
  }

  function handleAddStep() {
    markChanged();
    setSteps((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        position: prev.length + 1,
        delayMinutes: 60,
        window: null,
        message: { text: "Olá! Como podemos ajudar hoje?" },
      },
    ]);
  }

  function handleRemoveStep(index: number) {
    markChanged();
    setSteps((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((s, i) => ({ ...s, position: i + 1 }));
    });
  }

  function handleMoveStep(index: number, direction: "up" | "down") {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= steps.length) return;
    markChanged();
    setSteps((prev) => {
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[target];
      copy[target] = temp;
      return copy.map((s, i) => ({ ...s, position: i + 1 }));
    });
  }

  async function handleSave(newStatus?: "active" | "paused") {
    if (!name.trim()) {
      toast.error("Informe o nome da sequência.");
      return;
    }
    if (selectedChannels.length === 0) {
      toast.error("Escolha ao menos um canal para a sequência.");
      return;
    }

    const words = exitWordsText
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    startTransition(async () => {
      const formattedSteps = steps.map((s) => ({
        id: s.id.startsWith("temp-") ? undefined : s.id,
        delayMinutes: s.delayMinutes,
        window: s.window,
        message: s.message,
      }));

      const res = await saveSequence({
        id: sequence.id,
        name: name.trim(),
        settings: {
          channelIds: selectedChannels,
          exitOnReply,
          exitWords: words.length > 0 ? words : ["sair", "parar", "cancelar"],
        },
        steps: formattedSteps,
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      if (newStatus && newStatus !== status) {
        const statusRes = await setSequenceStatus({ id: sequence.id, status: newStatus });
        if (!statusRes.ok) {
          toast.error(statusRes.error);
          return;
        }
        setStatus(newStatus);
      }

      setHasChanges(false);
      toast.success("Sequência salva com sucesso.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* Barra de Ações Superior */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/automacoes/sequencias"
            className="inline-flex size-8 items-center justify-center rounded-lg border bg-background hover:bg-muted"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{name || "Sequência sem nome"}</h2>
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                  status === "active"
                    ? "bg-secondary text-secondary-foreground"
                    : status === "paused"
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                      : "text-muted-foreground"
                }`}
              >
                {status === "active" ? "Ativa" : status === "paused" ? "Pausada" : "Rascunho"}
              </span>
              {hasChanges && (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  • Alterações não salvas
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Configure as mensagens, tempos de espera e condições de saída.
            </p>
          </div>
        </div>

        {canWrite && (
          <div className="flex items-center gap-2">
            {status === "active" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => handleSave("paused")}
                className="gap-1.5"
              >
                <PauseIcon className="size-3.5 text-amber-600" />
                Pausar
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending || steps.length === 0}
                onClick={() => handleSave("active")}
                className="gap-1.5"
              >
                <PlayIcon className="size-3.5 text-emerald-600" />
                Ativar sequência
              </Button>
            )}

            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => handleSave()}
              className="gap-1.5"
            >
              {pending ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <SaveIcon className="size-3.5" />
              )}
              Salvar
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Coluna da Esquerda: Configurações da Sequência */}
        <div className="space-y-4 rounded-xl border p-4 bg-card shadow-xs">
          <h3 className="font-medium text-sm">Configurações gerais</h3>

          <div className="space-y-1.5">
            <Label htmlFor="seq-name-input">Nome</Label>
            <Input
              id="seq-name-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                markChanged();
              }}
              disabled={!canWrite || pending}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Canais vinculados</Label>
            <div className="space-y-1.5">
              {channels.map((ch) => {
                const checked = selectedChannels.includes(ch.id);
                return (
                  <label
                    key={ch.id}
                    className="flex items-center gap-2 text-xs text-foreground cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canWrite || pending}
                      onChange={(e) => {
                        markChanged();
                        if (e.target.checked) {
                          setSelectedChannels((prev) => [...prev, ch.id]);
                        } else {
                          setSelectedChannels((prev) => prev.filter((id) => id !== ch.id));
                        }
                      }}
                      className="rounded border"
                    />
                    <span>
                      {ch.name} ({ch.type === "instagram" ? "Instagram" : "Simulador"})
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t">
            <label className="flex items-start gap-2 text-xs text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={exitOnReply}
                disabled={!canWrite || pending}
                onChange={(e) => {
                  setExitOnReply(e.target.checked);
                  markChanged();
                }}
                className="mt-0.5 rounded border"
              />
              <span>Sair da sequência assim que o contato enviar qualquer resposta</span>
            </label>
          </div>

          <div className="space-y-1.5 pt-2 border-t">
            <Label htmlFor="exit-words">Palavras de saída (opt-out)</Label>
            <Input
              id="exit-words"
              value={exitWordsText}
              onChange={(e) => {
                setExitWordsText(e.target.value);
                markChanged();
              }}
              disabled={!canWrite || pending}
              placeholder="sair, parar, cancelar"
            />
            <p className="text-[11px] text-muted-foreground">
              Palavras separadas por vírgula. Se o contato digitar exatamente uma delas, ele sai automaticamente da sequência.
            </p>
          </div>
        </div>

        {/* Coluna Central/Direita: Lista de Passos */}
        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">Passos da sequência ({steps.length})</h3>
            {canWrite && (
              <Button type="button" size="xs" onClick={handleAddStep} className="gap-1">
                <PlusIcon className="size-3.5" />
                Adicionar passo
              </Button>
            )}
          </div>

          {steps.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center bg-card">
              <ClockIcon className="size-8 text-muted-foreground/60 mb-2" />
              <p className="text-sm font-medium">Nenhum passo adicionado.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Adicione mensagens que serão enviadas com intervalos de espera programados.
              </p>
              {canWrite && (
                <Button type="button" size="sm" variant="outline" onClick={handleAddStep} className="mt-4 gap-1.5">
                  <PlusIcon className="size-4" />
                  Adicionar primeiro passo
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {steps.map((step, idx) => (
                <StepCard
                  key={step.id}
                  index={idx}
                  total={steps.length}
                  step={step}
                  canWrite={canWrite}
                  disabled={pending}
                  activeAutomations={activeAutomations}
                  onMove={(dir) => handleMoveStep(idx, dir)}
                  onRemove={() => handleRemoveStep(idx)}
                  onChange={(updated) => {
                    markChanged();
                    setSteps((prev) => prev.map((s, i) => (i === idx ? updated : s)));
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepCard({
  index,
  total,
  step,
  canWrite,
  disabled,
  activeAutomations,
  onMove,
  onRemove,
  onChange,
}: {
  index: number;
  total: number;
  step: SequenceDetail["steps"][number];
  canWrite: boolean;
  disabled: boolean;
  activeAutomations: { id: string; name: string }[];
  onMove: (dir: "up" | "down") => void;
  onRemove: () => void;
  onChange: (step: SequenceDetail["steps"][number]) => void;
}) {
  const stepId = useId();
  const currentDelay = minutesToDelay(step.delayMinutes);
  const [delayValue, setDelayValue] = useState(currentDelay.value);
  const [delayUnit, setDelayUnit] = useState<DelayUnit>(currentDelay.unit);

  const hasWindow = Boolean(step.window);

  function updateDelay(val: number, u: DelayUnit) {
    setDelayValue(val);
    setDelayUnit(u);
    onChange({
      ...step,
      delayMinutes: delayToMinutes(val, u),
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-xs space-y-4">
      {/* Cabeçalho do Passo */}
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {index + 1}
          </span>
          <span className="text-sm font-semibold">Passo {index + 1}</span>
          <span className="text-xs text-muted-foreground">
            {index === 0
              ? "(após a inscrição)"
              : `(após o passo ${index})`}
          </span>
        </div>

        {canWrite && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={disabled || index === 0}
              onClick={() => onMove("up")}
              title="Mover para cima"
            >
              <ArrowUpIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={disabled || index === total - 1}
              onClick={() => onMove("down")}
              title="Mover para baixo"
            >
              <ArrowDownIcon className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 text-destructive hover:text-destructive"
              disabled={disabled}
              onClick={onRemove}
              title="Excluir passo"
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Tempo de Espera */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${stepId}-delay`}>Tempo de espera</Label>
          <div className="flex gap-2">
            <Input
              id={`${stepId}-delay`}
              type="number"
              min={1}
              max={delayUnit === "days" ? 30 : delayUnit === "hours" ? 720 : 43200}
              value={delayValue}
              disabled={!canWrite || disabled}
              onChange={(e) => updateDelay(Math.max(1, Number(e.target.value) || 1), delayUnit)}
              className="w-24 text-sm"
            />
            <select
              value={delayUnit}
              disabled={!canWrite || disabled}
              onChange={(e) => updateDelay(delayValue, e.target.value as DelayUnit)}
              className={selectClass}
            >
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
              <option value="days">Dias</option>
            </select>
          </div>
        </div>

        {/* Janela de Horário */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label>Janela de horário</Label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={hasWindow}
                disabled={!canWrite || disabled}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange({
                      ...step,
                      window: {
                        days: [1, 2, 3, 4, 5],
                        start: "09:00",
                        end: "18:00",
                      },
                    });
                  } else {
                    onChange({
                      ...step,
                      window: null,
                    });
                  }
                }}
                className="rounded border"
              />
              <span>Restringir</span>
            </label>
          </div>

          {step.window ? (
            <div className="space-y-2 rounded border bg-muted/20 p-2 text-xs">
              <div className="flex items-center gap-1">
                <span>Entre</span>
                <input
                  type="time"
                  value={step.window.start}
                  disabled={!canWrite || disabled}
                  onChange={(e) =>
                    onChange({
                      ...step,
                      window: { ...step.window!, start: e.target.value },
                    })
                  }
                  className="rounded border bg-background px-1 py-0.5"
                />
                <span>e</span>
                <input
                  type="time"
                  value={step.window.end}
                  disabled={!canWrite || disabled}
                  onChange={(e) =>
                    onChange({
                      ...step,
                      window: { ...step.window!, end: e.target.value },
                    })
                  }
                  className="rounded border bg-background px-1 py-0.5"
                />
              </div>

              <div className="flex flex-wrap gap-1">
                {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                  const daySelected = step.window?.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={!canWrite || disabled}
                      onClick={() => {
                        const currentDays = step.window?.days || [];
                        const nextDays = daySelected
                          ? currentDays.filter((d) => d !== day)
                          : [...currentDays, day];
                        if (nextDays.length === 0) return;
                        onChange({
                          ...step,
                          window: { ...step.window!, days: nextDays },
                        });
                      }}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium border ${
                        daySelected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {WEEKDAY_LABEL[day] || day}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground pt-1.5">
              Qualquer dia e horário (respeitando a janela do canal).
            </p>
          )}
        </div>
      </div>

      {/* Conteúdo da Mensagem */}
      <div className="border-t pt-3">
        <OutreachMessageForm
          value={step.message}
          onChange={(msg) => onChange({ ...step, message: msg })}
          activeAutomations={activeAutomations}
          disabled={!canWrite || disabled}
        />
      </div>
    </div>
  );
}
