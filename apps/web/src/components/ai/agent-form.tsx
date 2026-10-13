"use client";

import { useTransition, type ComponentProps, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { agentConfigSchema, type AgentConfigInput } from "@flowai/core";
import { applyFieldErrors } from "@/lib/apply-field-errors";
import { saveAgent } from "@/lib/ai/actions";
import type { AiAgentRow } from "@/lib/ai/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormValues = z.input<typeof agentConfigSchema>;

const textarea = "w-full rounded-lg border border-input bg-transparent p-2 text-sm disabled:opacity-50 aria-invalid:border-destructive";

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Toggle({ id, label, ...rest }: { id: string; label: string } & ComponentProps<"input">) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" role="switch" className="size-4" {...rest} />
      {label}
    </label>
  );
}

export function AgentForm({ orgId, agent, canWrite }: { orgId: string; agent: AiAgentRow; canWrite: boolean }) {
  const client = useQueryClient();
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, setError, control, formState: { errors } } = useForm<FormValues, unknown, AgentConfigInput>({
    resolver: zodResolver(agentConfigSchema),
    defaultValues: agent,
  });
  const promptLength = (useWatch({ control, name: "systemPrompt" }) ?? "").length;
  const disabled = !canWrite || pending;

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await saveAgent(values);
      if (!result.ok) {
        if (applyFieldErrors(setError, result.fieldErrors)) return;
        toast.error(result.error);
        return;
      }
      toast.success("Agente salvo.");
      void client.invalidateQueries({ queryKey: ["ai-agent", orgId] });
    });
  });

  const invalid = (name: keyof FormValues) => ({ "aria-invalid": !!errors[name], "aria-describedby": errors[name] ? `agent-${name}-error` : undefined });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3 rounded-xl border p-4">
      <h2 className="font-medium">Agente</h2>
      <Field id="agent-name" label="Nome" error={errors.name?.message}>
        <Input id="agent-name" disabled={disabled} autoComplete="off" {...invalid("name")} {...register("name")} />
      </Field>
      <Field id="agent-personality" label="Personalidade" error={errors.personality?.message}>
        <textarea id="agent-personality" rows={3} disabled={disabled} className={textarea} {...invalid("personality")} {...register("personality")} />
      </Field>
      <Field id="agent-objective" label="Objetivo" error={errors.objective?.message}>
        <textarea id="agent-objective" rows={3} disabled={disabled} className={textarea} {...invalid("objective")} {...register("objective")} />
      </Field>
      <Field id="agent-tone" label="Tom" error={errors.tone?.message}>
        <Input id="agent-tone" disabled={disabled} autoComplete="off" {...invalid("tone")} {...register("tone")} />
      </Field>
      <Field id="agent-systemPrompt" label="Instruções adicionais" error={errors.systemPrompt?.message}>
        <textarea id="agent-systemPrompt" rows={6} disabled={disabled} className={textarea} {...invalid("systemPrompt")} {...register("systemPrompt")} />
        <p className="text-right text-xs text-muted-foreground">{promptLength} / 8000</p>
      </Field>
      <div className="flex flex-col gap-2">
        <Toggle id="agent-isActive" label="Agente ativo" disabled={disabled} {...register("isActive")} />
        <Toggle id="agent-autoReply" label="Responder automaticamente" disabled={disabled} {...register("autoReply")} />
        <Toggle id="agent-humanHandoff" label="Transferir para humano quando necessário" disabled={disabled} {...register("humanHandoff")} />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled}>
          {pending && <Loader2Icon className="animate-spin" />}
          Salvar
        </Button>
        {!canWrite && <p className="text-sm text-muted-foreground">Somente administradores podem alterar o agente.</p>}
      </div>
    </form>
  );
}
