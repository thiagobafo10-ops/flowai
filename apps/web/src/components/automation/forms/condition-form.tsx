"use client";

import { useWatch } from "react-hook-form";
import { nodeConfigSchemas } from "@flowai/core";
import type { EditorRefs } from "@/lib/automation/queries";
import { Input } from "@/components/ui/input";
import { WEEKDAY_LABEL } from "../nodes/labels";
import {
  Field, KeywordModeOptions, KeywordsField, RefOptions, cleanKeywords, errorAt, invalidProps, rec, selectClass, str, useLiveForm, type FormProps,
} from "./fields";

type Kind = "keyword" | "has_tag" | "stage_is" | "lead_score_gte" | "intent_is" | "business_hours";
type V = {
  kind: Kind;
  keywords: string[];
  mode: string;
  tagId: string;
  stageId: string;
  value: number;
  intent: string;
  days: string[];
  start: string;
  end: string;
};

const KIND_LABEL: Record<Kind, string> = {
  keyword: "A última mensagem tem palavra-chave",
  has_tag: "O contato tem a etiqueta",
  stage_is: "O negócio está na etapa",
  lead_score_gte: "Pontuação do lead é pelo menos",
  intent_is: "A intenção detectada é",
  business_hours: "Está no horário comercial",
};

function toValues(config: unknown): V {
  const c = rec(config);
  return {
    kind: (Object.keys(KIND_LABEL).includes(str(c.kind)) ? c.kind : "keyword") as Kind,
    keywords: Array.isArray(c.keywords) ? (c.keywords as string[]) : [],
    mode: str(c.mode, "contains"),
    tagId: str(c.tagId),
    stageId: str(c.stageId),
    value: typeof c.value === "number" ? c.value : 50,
    intent: str(c.intent),
    days: Array.isArray(c.days) ? c.days.map(String) : ["1", "2", "3", "4", "5"],
    start: str(c.start, "09:00"),
    end: str(c.end, "18:00"),
  };
}

function toConfig(v: V): unknown {
  switch (v.kind) {
    case "keyword":
      return { kind: v.kind, keywords: cleanKeywords(v.keywords), mode: v.mode };
    case "has_tag":
      return { kind: v.kind, tagId: v.tagId };
    case "stage_is":
      return { kind: v.kind, stageId: v.stageId };
    case "lead_score_gte":
      return { kind: v.kind, value: Number.isFinite(v.value) ? v.value : undefined };
    case "intent_is":
      return { kind: v.kind, intent: v.intent };
    case "business_hours":
      return { kind: v.kind, days: (v.days ?? []).map(Number).sort((a, b) => a - b), start: v.start, end: v.end };
  }
}

export function ConditionForm({ refs, config, onChange }: FormProps & { refs: EditorRefs }) {
  const { register, control, formState: { errors } } = useLiveForm<V>(nodeConfigSchemas.condition, toValues(config), toConfig, onChange);
  const kind = useWatch({ control, name: "kind" });
  const err = (path: string) => errorAt(errors, path);
  return (
    <div className="space-y-3">
      <Field id="condition-kind" label="Verificar se">
        <select id="condition-kind" className={selectClass} {...register("kind")}>
          {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      {kind === "keyword" && (
        <>
          <KeywordsField id="condition-keywords" control={control} name="keywords" error={errorAt(errors, "keywords", true)} />
          <Field id="condition-mode" label="Comparação">
            <select id="condition-mode" className={selectClass} {...register("mode")}><KeywordModeOptions /></select>
          </Field>
        </>
      )}
      {kind === "has_tag" && (
        <Field id="condition-tag" label="Etiqueta" error={err("tagId")}>
          <select id="condition-tag" className={selectClass} {...invalidProps("condition-tag", err("tagId"))} {...register("tagId")}>
            <RefOptions options={refs.tags} empty="Escolha a etiqueta" />
          </select>
        </Field>
      )}
      {kind === "stage_is" && (
        <Field id="condition-stage" label="Etapa" error={err("stageId")}>
          <select id="condition-stage" className={selectClass} {...invalidProps("condition-stage", err("stageId"))} {...register("stageId")}>
            <RefOptions options={refs.stages} empty="Escolha a etapa" />
          </select>
        </Field>
      )}
      {kind === "lead_score_gte" && (
        <Field id="condition-value" label="Pontuação mínima (0 a 100)" error={err("value")}>
          <Input id="condition-value" type="number" min={0} max={100} step={1} {...invalidProps("condition-value", err("value"))} {...register("value", { valueAsNumber: true })} />
        </Field>
      )}
      {kind === "intent_is" && (
        <Field id="condition-intent" label="Intenção" error={err("intent")} hint="Como a IA classificou a última mensagem, por exemplo: compra.">
          <Input id="condition-intent" autoComplete="off" {...invalidProps("condition-intent", err("intent"))} {...register("intent")} />
        </Field>
      )}
      {kind === "business_hours" && (
        <>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Dias</legend>
            <div className="flex flex-wrap gap-3">
              {Object.entries(WEEKDAY_LABEL).map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" value={value} className="size-4" {...register("days")} />
                  {label}
                </label>
              ))}
            </div>
            {err("days") && <p className="text-sm text-destructive">{err("days")}</p>}
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <Field id="condition-start" label="Início" error={err("start")}>
              <Input id="condition-start" type="time" {...invalidProps("condition-start", err("start"))} {...register("start")} />
            </Field>
            <Field id="condition-end" label="Fim" error={err("end")}>
              <Input id="condition-end" type="time" {...invalidProps("condition-end", err("end"))} {...register("end")} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">Usa o fuso horário da organização.</p>
        </>
      )}
    </div>
  );
}
