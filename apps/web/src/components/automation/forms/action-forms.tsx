"use client";

import { nodeConfigSchemas } from "@flowai/core";
import type { EditorRefs } from "@/lib/automation/queries";
import { Input } from "@/components/ui/input";
import { rec, str } from "@/lib/automation/config-utils";
import { Field, RefOptions, errorAt, invalidProps, selectClass, useLiveForm, type FormProps } from "./fields";
import { delayToConfig, delayToValues, type DelayValues } from "./mappings";

export function DelayForm({ config, onChange }: FormProps) {
  const { register, formState: { errors } } = useLiveForm<DelayValues>(nodeConfigSchemas.delay, delayToValues(config), delayToConfig, onChange);
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
