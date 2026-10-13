"use client";

import { useFieldArray, useWatch } from "react-hook-form";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { nodeConfigSchemas } from "@flowai/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, errorAt, invalidProps, rec, selectClass, str, textareaClass, useLiveForm, type FormProps } from "./fields";

const MAX_BUTTONS = 3;
const MAX_QUICK_REPLIES = 13;

type ButtonValue = { id: string; title: string; kind: "path" | "url"; url: string };
type QuickValue = { id: string; title: string };
type V = {
  mode: "text" | "ai";
  text: string;
  options: "none" | "buttons" | "quickReplies";
  buttons: ButtonValue[];
  quickReplies: QuickValue[];
  replyTimeoutHours: number;
};

/** Identificador curto da opção (vira a saída `opt:<id>`); o admin só edita o título. */
function newOptionId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function toValues(config: unknown): V {
  const c = rec(config);
  const buttons = Array.isArray(c.buttons)
    ? c.buttons.map((b) => {
        const r = rec(b);
        return { id: str(r.id), title: str(r.title), kind: r.kind === "url" ? "url" : "path", url: str(r.url) } as ButtonValue;
      })
    : [];
  const quickReplies = Array.isArray(c.quickReplies) ? c.quickReplies.map((q) => ({ id: str(rec(q).id), title: str(rec(q).title) })) : [];
  return {
    mode: c.mode === "ai" ? "ai" : "text",
    text: str(c.text),
    options: buttons.length ? "buttons" : quickReplies.length ? "quickReplies" : "none",
    buttons,
    quickReplies,
    replyTimeoutHours: typeof c.replyTimeoutHours === "number" ? c.replyTimeoutHours : 24,
  };
}

function toConfig(v: V): unknown {
  if (v.mode === "ai") return { mode: "ai" };
  const config: Record<string, unknown> = { mode: "text", text: v.text ?? "" };
  if (v.options === "buttons" && v.buttons?.length) {
    config.buttons = v.buttons.map((b) =>
      b.kind === "url" ? { id: b.id, title: b.title, kind: "url", url: b.url?.trim() || undefined } : { id: b.id, title: b.title, kind: "path" },
    );
  }
  if (v.options === "quickReplies" && v.quickReplies?.length) {
    config.quickReplies = v.quickReplies.map((q) => ({ id: q.id, title: q.title }));
  }
  config.replyTimeoutHours = Number.isFinite(v.replyTimeoutHours) ? v.replyTimeoutHours : 24;
  return config;
}

export function MessageForm({ config, onChange, instagram }: FormProps & { instagram: boolean }) {
  const { register, control, formState: { errors } } = useLiveForm<V>(nodeConfigSchemas.message, toValues(config), toConfig, onChange);
  const buttons = useFieldArray({ control, name: "buttons", keyName: "key" });
  const quickReplies = useFieldArray({ control, name: "quickReplies", keyName: "key" });
  const [mode, text, options, buttonValues] = useWatch({ control, name: ["mode", "text", "options", "buttons"] }) as [
    V["mode"], V["text"], V["options"], ButtonValue[],
  ];
  const err = (path: string) => errorAt(errors, path);
  const bytes = new TextEncoder().encode(text ?? "").length;

  return (
    <div className="space-y-3">
      <Field id="message-mode" label="Conteúdo">
        <select id="message-mode" className={selectClass} {...register("mode")}>
          <option value="text">Texto escrito por você</option>
          <option value="ai">Resposta gerada pela IA</option>
        </select>
      </Field>
      {mode === "ai" ? (
        <p className="text-sm text-muted-foreground">
          A IA responde à última mensagem do contato. Saídas: <strong>Enviada</strong> ou <strong>Transferiu</strong> (quando a IA passa para um atendente).
        </p>
      ) : (
        <>
          <Field
            id="message-text"
            label="Mensagem"
            error={err("text")}
            hint={
              <>
                Use {"{primeiro_nome}"} ou {"{nome}"}. {(text ?? "").length} / 4096 caracteres
                {instagram && `, ${bytes} / 1000 bytes no Instagram`}.
              </>
            }
          >
            <textarea id="message-text" rows={5} className={textareaClass} {...invalidProps("message-text", err("text"))} {...register("text")} />
          </Field>
          <Field id="message-options" label="Opções de resposta">
            <select id="message-options" className={selectClass} {...register("options")}>
              <option value="none">Nenhuma</option>
              <option value="buttons">Botões (até 3)</option>
              <option value="quickReplies">Respostas rápidas (até 13)</option>
            </select>
          </Field>

          {options === "buttons" && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Botões</legend>
              {buttons.fields.map((f, i) => (
                <div key={f.key} className="space-y-2 rounded-lg border p-2">
                  <div className="flex gap-2">
                    <Input aria-label={`Título do botão ${i + 1}`} maxLength={20} placeholder="Título" {...invalidProps(`button-${i}-title`, err(`buttons.${i}.title`))} {...register(`buttons.${i}.title`)} />
                    <select aria-label={`Tipo do botão ${i + 1}`} className={selectClass} {...register(`buttons.${i}.kind`)}>
                      <option value="path">Seguir caminho</option>
                      <option value="url">Abrir link</option>
                    </select>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remover botão ${i + 1}`} onClick={() => buttons.remove(i)}>
                      <Trash2Icon />
                    </Button>
                  </div>
                  {buttonValues?.[i]?.kind === "url" && (
                    <Input aria-label={`Link do botão ${i + 1}`} type="url" placeholder="https://" {...invalidProps(`button-${i}-url`, err(`buttons.${i}.url`))} {...register(`buttons.${i}.url`)} />
                  )}
                  {err(`buttons.${i}.title`) && <p id={`button-${i}-title-error`} className="text-sm text-destructive">{err(`buttons.${i}.title`)}</p>}
                  {err(`buttons.${i}.url`) && <p id={`button-${i}-url-error`} className="text-sm text-destructive">{err(`buttons.${i}.url`)}</p>}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={buttons.fields.length >= MAX_BUTTONS}
                onClick={() => buttons.append({ id: newOptionId(), title: "", kind: "path", url: "" })}
              >
                <PlusIcon />
                Adicionar botão
              </Button>
              <p className="text-xs text-muted-foreground">Botões “Seguir caminho” viram saídas do bloco; “Abrir link” só abre a página.</p>
            </fieldset>
          )}

          {options === "quickReplies" && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Respostas rápidas</legend>
              {quickReplies.fields.map((f, i) => (
                <div key={f.key} className="flex gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Input aria-label={`Resposta rápida ${i + 1}`} maxLength={20} placeholder="Título" {...invalidProps(`quick-${i}`, err(`quickReplies.${i}.title`))} {...register(`quickReplies.${i}.title`)} />
                    {err(`quickReplies.${i}.title`) && <p id={`quick-${i}-error`} className="text-sm text-destructive">{err(`quickReplies.${i}.title`)}</p>}
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remover resposta rápida ${i + 1}`} onClick={() => quickReplies.remove(i)}>
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={quickReplies.fields.length >= MAX_QUICK_REPLIES}
                onClick={() => quickReplies.append({ id: newOptionId(), title: "" })}
              >
                <PlusIcon />
                Adicionar resposta rápida
              </Button>
            </fieldset>
          )}

          {options !== "none" && (
            <>
              {(err("buttons") || err("quickReplies")) && <p className="text-sm text-destructive">{err("buttons") ?? err("quickReplies")}</p>}
              <Field id="message-timeout" label="Prazo para responder (horas)" error={err("replyTimeoutHours")} hint="De 1 a 168 horas. Depois disso, segue pela saída “Sem resposta”.">
                <Input id="message-timeout" type="number" min={1} max={168} step={1} {...invalidProps("message-timeout", err("replyTimeoutHours"))} {...register("replyTimeoutHours", { valueAsNumber: true })} />
              </Field>
            </>
          )}
        </>
      )}
    </div>
  );
}
