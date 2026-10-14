"use client";

import { useId } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import type { OutreachMessage } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type OptionKind = "none" | "buttons" | "quick_replies";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function randomOptionId(): string {
  return Math.random().toString(36).substring(2, 8);
}

export function OutreachMessageForm({
  value,
  onChange,
  activeAutomations,
  disabled = false,
}: {
  value: OutreachMessage;
  onChange: (value: OutreachMessage) => void;
  activeAutomations: { id: string; name: string }[];
  disabled?: boolean;
}) {
  const formId = useId();

  const currentKind: OptionKind =
    (value.buttons?.length ?? 0) > 0
      ? "buttons"
      : (value.quickReplies?.length ?? 0) > 0
        ? "quick_replies"
        : "none";

  const textBytes = new TextEncoder().encode(value.text || "").byteLength;
  const isOver640 = currentKind === "buttons" && (value.text?.length ?? 0) > 640;
  const isOver1000Bytes = textBytes > 1000;

  function handleKindChange(kind: OptionKind) {
    if (kind === "none") {
      onChange({ text: value.text });
    } else if (kind === "buttons") {
      onChange({
        text: value.text,
        buttons: [{ id: randomOptionId(), title: "Ver mais", kind: "url", url: "https://" }],
      });
    } else {
      onChange({
        text: value.text,
        quickReplies: [
          {
            id: randomOptionId(),
            title: "Sim",
            automationId: activeAutomations[0]?.id ?? "",
          },
        ],
      });
    }
  }

  function insertVariable(v: string) {
    onChange({ ...value, text: (value.text || "") + v });
  }

  return (
    <div className="space-y-4">
      {/* Texto da mensagem */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={`${formId}-text`}>Texto da mensagem</Label>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Variáveis:</span>
            <button
              type="button"
              onClick={() => insertVariable("{primeiro_nome}")}
              disabled={disabled}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted/80"
            >
              {"{primeiro_nome}"}
            </button>
            <button
              type="button"
              onClick={() => insertVariable("{nome}")}
              disabled={disabled}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted/80"
            >
              {"{nome}"}
            </button>
          </div>
        </div>

        <textarea
          id={`${formId}-text`}
          rows={4}
          value={value.text || ""}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          placeholder="Digite o texto da mensagem que será enviada..."
          disabled={disabled}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{value.text?.length || 0} caracteres · {textBytes} bytes</span>
          {isOver640 && (
            <span className="font-medium text-amber-600 dark:text-amber-400">
              Aviso: com botões no Instagram, o limite é 640 caracteres.
            </span>
          )}
          {!isOver640 && isOver1000Bytes && (
            <span className="font-medium text-amber-600 dark:text-amber-400">
              Aviso: o Instagram limita mensagens a 1000 bytes.
            </span>
          )}
        </div>
      </div>

      {/* Tipo de Opções Interativas */}
      <div className="space-y-2">
        <Label>Opções interativas</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="xs"
            variant={currentKind === "none" ? "secondary" : "outline"}
            disabled={disabled}
            onClick={() => handleKindChange("none")}
          >
            Sem opções
          </Button>
          <Button
            type="button"
            size="xs"
            variant={currentKind === "buttons" ? "secondary" : "outline"}
            disabled={disabled}
            onClick={() => handleKindChange("buttons")}
          >
            Botões (até 3)
          </Button>
          <Button
            type="button"
            size="xs"
            variant={currentKind === "quick_replies" ? "secondary" : "outline"}
            disabled={disabled}
            onClick={() => handleKindChange("quick_replies")}
          >
            Respostas rápidas (até 13)
          </Button>
        </div>
      </div>

      {/* Botões */}
      {currentKind === "buttons" && (
        <div className="space-y-2 rounded-lg border p-3 bg-muted/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Botões da mensagem</span>
            {(value.buttons?.length ?? 0) < 3 && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={disabled}
                onClick={() => {
                  const b = [...(value.buttons ?? [])];
                  b.push({ id: randomOptionId(), title: "Opção", kind: "url", url: "https://" });
                  onChange({ ...value, buttons: b });
                }}
                className="gap-1"
              >
                <PlusIcon className="size-3" />
                Adicionar botão
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {(value.buttons ?? []).map((btn, index) => (
              <div key={btn.id} className="flex flex-wrap items-center gap-2 rounded border bg-background p-2 text-xs">
                <div className="w-32">
                  <Input
                    placeholder="Título (até 20)"
                    maxLength={20}
                    value={btn.title}
                    disabled={disabled}
                    onChange={(e) => {
                      const b = [...(value.buttons ?? [])];
                      b[index] = { ...b[index], title: e.target.value };
                      onChange({ ...value, buttons: b });
                    }}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="w-28">
                  <select
                    value={btn.kind}
                    disabled={disabled}
                    onChange={(e) => {
                      const kind = e.target.value as "url" | "automation";
                      const b = [...(value.buttons ?? [])];
                      if (kind === "url") {
                        b[index] = { id: btn.id, title: btn.title, kind: "url", url: "https://" };
                      } else {
                        b[index] = {
                          id: btn.id,
                          title: btn.title,
                          kind: "automation",
                          automationId: activeAutomations[0]?.id ?? "",
                        };
                      }
                      onChange({ ...value, buttons: b });
                    }}
                    className={`${selectClass} h-8 text-xs`}
                  >
                    <option value="url">Link (URL)</option>
                    <option value="automation">Automação</option>
                  </select>
                </div>

                <div className="flex-1 min-w-40">
                  {btn.kind === "url" ? (
                    <Input
                      placeholder="https://exemplo.com"
                      value={btn.url ?? ""}
                      disabled={disabled}
                      onChange={(e) => {
                        const b = [...(value.buttons ?? [])];
                        b[index] = { ...b[index], url: e.target.value as `https://${string}` };
                        onChange({ ...value, buttons: b });
                      }}
                      className="h-8 text-xs"
                    />
                  ) : (
                    <select
                      value={btn.automationId ?? ""}
                      disabled={disabled}
                      onChange={(e) => {
                        const b = [...(value.buttons ?? [])];
                        b[index] = { ...b[index], automationId: e.target.value };
                        onChange({ ...value, buttons: b });
                      }}
                      className={`${selectClass} h-8 text-xs`}
                    >
                      {activeAutomations.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  disabled={disabled || (value.buttons?.length ?? 0) <= 1}
                  onClick={() => {
                    const b = (value.buttons ?? []).filter((_, i) => i !== index);
                    onChange({ ...value, buttons: b });
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Respostas Rápidas */}
      {currentKind === "quick_replies" && (
        <div className="space-y-2 rounded-lg border p-3 bg-muted/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Respostas rápidas</span>
            {(value.quickReplies?.length ?? 0) < 13 && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={disabled}
                onClick={() => {
                  const q = [...(value.quickReplies ?? [])];
                  q.push({
                    id: randomOptionId(),
                    title: "Opção",
                    automationId: activeAutomations[0]?.id ?? "",
                  });
                  onChange({ ...value, quickReplies: q });
                }}
                className="gap-1"
              >
                <PlusIcon className="size-3" />
                Adicionar resposta
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {(value.quickReplies ?? []).map((qr, index) => (
              <div key={qr.id} className="flex items-center gap-2 rounded border bg-background p-2 text-xs">
                <div className="w-36">
                  <Input
                    placeholder="Título (até 20)"
                    maxLength={20}
                    value={qr.title}
                    disabled={disabled}
                    onChange={(e) => {
                      const q = [...(value.quickReplies ?? [])];
                      q[index] = { ...q[index], title: e.target.value };
                      onChange({ ...value, quickReplies: q });
                    }}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="flex-1">
                  <select
                    value={qr.automationId}
                    disabled={disabled}
                    onChange={(e) => {
                      const q = [...(value.quickReplies ?? [])];
                      q[index] = { ...q[index], automationId: e.target.value };
                      onChange({ ...value, quickReplies: q });
                    }}
                    className={`${selectClass} h-8 text-xs`}
                  >
                    {activeAutomations.map((a) => (
                      <option key={a.id} value={a.id}>
                        Iniciar: {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  disabled={disabled || (value.quickReplies?.length ?? 0) <= 1}
                  onClick={() => {
                    const q = (value.quickReplies ?? []).filter((_, i) => i !== index);
                    onChange({ ...value, quickReplies: q });
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
