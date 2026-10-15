"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Controller, get, useForm, useWatch, type Control, type DefaultValues, type FieldErrors, type FieldPath, type FieldValues, type Resolver,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Label } from "@/components/ui/label";
import { friendlyMessage } from "../issue-copy";
import { KEYWORD_MODE_LABEL } from "@/lib/automation/node-labels";

export const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground";
export const textareaClass =
  "w-full rounded-lg border border-input bg-transparent p-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive disabled:opacity-50";

export type FormProps = { config: unknown; onChange: (config: unknown) => void };

/**
 * Formulário RHF que valida com o schema Zod do core (aplicado sobre a config montada a partir dos campos)
 * e devolve a config a cada alteração, para o editor atualizar o nó e a validação ao vivo.
 * `schema` e `toConfig` são fixados na montagem (cada formulário é recriado, via `key`, ao trocar de passo ou de tipo).
 */
export function useLiveForm<V extends FieldValues>(schema: z.ZodType, defaultValues: V, toConfig: (values: V) => unknown, onChange: (config: unknown) => void) {
  const [setup] = useState(() => ({
    toConfig,
    initialKey: JSON.stringify(toConfig(defaultValues)),
    // Os campos do formulário são convertidos na config antes do schema do core: o tipo de entrada é o do formulário.
    resolver: zodResolver(z.preprocess((v) => toConfig(v as V), schema) as unknown as z.ZodType<unknown, V>) as unknown as Resolver<V>,
  }));
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const form = useForm<V>({ resolver: setup.resolver, defaultValues: defaultValues as DefaultValues<V> });
  const { control, trigger } = form;
  // useWatch acompanha também inclusões e remoções em listas (useFieldArray).
  const values = useWatch({ control }) as V;
  const lastKey = useRef(setup.initialKey);
  useEffect(() => {
    void trigger();
  }, [trigger]);
  useEffect(() => {
    const config = setup.toConfig(values);
    const key = JSON.stringify(config);
    if (key === lastKey.current) return;
    lastKey.current = key;
    onChangeRef.current(config);
    void trigger();
  }, [values, setup, trigger]);
  return form;
}

/**
 * Mensagem de erro em um caminho da config (ex.: "buttons.0.title"). Em listas, considera o erro da própria lista
 * (`root`) e, com `deep`, também o primeiro erro de item.
 */
export function errorAt(errors: FieldErrors, path: string, deep = false): string | undefined {
  const e = get(errors, path) as Record<string, unknown> | undefined;
  if (!e) return undefined;
  if (typeof e.message === "string") return friendlyMessage(e.message);
  const root = e.root as { message?: unknown } | undefined;
  if (typeof root?.message === "string") return friendlyMessage(root.message);
  if (!deep) return undefined;
  for (const value of Object.values(e)) {
    const m = (value as { message?: unknown } | undefined)?.message;
    if (typeof m === "string") return friendlyMessage(m);
  }
  return undefined;
}

export function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

export const invalidProps = (id: string, error?: string) => ({ "aria-invalid": !!error, "aria-describedby": error ? `${id}-error` : undefined });

/** Lista de palavras-chave editada como texto, uma por linha (linhas vazias são ignoradas na config). */
export function KeywordsField<V extends FieldValues>({ id, control, name, error }: { id: string; control: Control<V>; name: FieldPath<V>; error?: string }) {
  return (
    <Field id={id} label="Palavras-chave" error={error} hint="Uma por linha. Maiúsculas e acentos são ignorados.">
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <textarea
            id={id}
            rows={3}
            className={textareaClass}
            value={((field.value as string[] | undefined) ?? []).join("\n")}
            onChange={(e) => field.onChange(e.target.value.split("\n"))}
            onBlur={field.onBlur}
            {...invalidProps(id, error)}
          />
        )}
      />
    </Field>
  );
}


export function KeywordModeOptions({ includeAny = false }: { includeAny?: boolean } = {}) {
  const entries = Object.entries(KEYWORD_MODE_LABEL).filter(([k]) => includeAny || k !== "any");
  return (
    <>
      {entries.map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </>
  );
}

export function RefOptions({ options, empty }: { options: { id: string; name: string }[]; empty: string }) {
  return (
    <>
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </>
  );
}

