"use client";

import { nodeConfigSchemas } from "@flowai/core";
import type { EditorRefs } from "@/lib/automation/queries";
import { Input } from "@/components/ui/input";
import { Field, RefOptions, errorAt, invalidProps, rec, selectClass, str, useLiveForm, type FormProps } from "./fields";

type Unit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 1440 };

function splitMinutes(minutes: unknown): { amount: number; unit: Unit } {
  const m = typeof minutes === "number" && Number.isFinite(minutes) ? minutes : 60;
  if (m > 0 && m % 1440 === 0) return { amount: m / 1440, unit: "days" };
  if (m > 0 && m % 60 === 0) return { amount: m / 60, unit: "hours" };
  return { amount: m, unit: "minutes" };
}

export function DelayForm({ config, onChange }: FormProps) {
  type V = { amount: number; unit: Unit };
  const toConfig = (v: V) => ({ minutes: Math.round(Number(v.amount) * UNIT_MINUTES[v.unit]) });
  const { register, formState: { errors } } = useLiveForm<V>(nodeConfigSchemas.delay, splitMinutes(rec(config).minutes), toConfig, onChange);
  const error = errorAt(errors, "minutes");
  return (
    <Field id="delay-amount" label="Esperar" error={error} hint="De 1 minuto a 7 dias.">
      <div className="flex gap-2">
        <Input id="delay-amount" type="number" min={1} step={1} {...invalidProps("delay-amount", error)} {...register("amount", { valueAsNumber: true })} />
        <select aria-label="Unidade" className={selectClass} {...register("unit")}>
          <option value="minutes">minutos</option>
          <option value="hours">horas</option>
          <option value="days">dias</option>
        </select>
      </div>
    </Field>
  );
}

type RefKind = "tags" | "stages" | "members";
const REF_FIELD: Record<RefKind, { key: "tagId" | "stageId" | "userId"; label: string; empty: string }> = {
  tags: { key: "tagId", label: "Etiqueta", empty: "Escolha a etiqueta" },
  stages: { key: "stageId", label: "Etapa do funil", empty: "Escolha a etapa" },
  members: { key: "userId", label: "Responsável", empty: "Escolha o responsável" },
};

/** Etiqueta (adicionar/remover), etapa ou responsável: um único seletor alimentado por `refs`. */
export function RefForm({ type, kind, refs, config, onChange }: FormProps & { type: "tag" | "remove_tag" | "move_stage" | "assign_user"; kind: RefKind; refs: EditorRefs }) {
  const { key, label, empty } = REF_FIELD[kind];
  type V = { value: string };
  const toConfig = (v: V) => ({ [key]: v.value });
  const { register, formState: { errors } } = useLiveForm<V>(nodeConfigSchemas[type], { value: str(rec(config)[key]) }, toConfig, onChange);
  const error = errorAt(errors, key);
  const id = `node-${key}`;
  return (
    <Field id={id} label={label} error={error} hint={refs[kind].length === 0 ? "Nenhuma opção cadastrada ainda." : undefined}>
      <select id={id} className={selectClass} {...invalidProps(id, error)} {...register("value")}>
        <RefOptions options={refs[kind]} empty={empty} />
      </select>
    </Field>
  );
}

export function WebhookForm({ config, onChange }: FormProps) {
  type V = { url: string };
  const { register, formState: { errors } } = useLiveForm<V>(nodeConfigSchemas.webhook, { url: str(rec(config).url) }, (v) => ({ url: v.url }), onChange);
  const error = errorAt(errors, "url");
  return (
    <Field id="webhook-url" label="URL" error={error} hint="Somente HTTPS. Em caso de falha, tentamos de novo até 3 vezes.">
      <Input id="webhook-url" type="url" inputMode="url" autoComplete="off" placeholder="https://" {...invalidProps("webhook-url", error)} {...register("url")} />
    </Field>
  );
}
