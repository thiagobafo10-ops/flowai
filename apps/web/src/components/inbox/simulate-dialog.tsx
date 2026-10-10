"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { simulateInbound } from "@/lib/inbox/channel-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type FieldErrors = Partial<Record<"name" | "phone" | "text", string>>;

/** Formulário de simulação de mensagem recebida (página de canais e Inbox). */
export function SimulateForm({
  onDone,
  idPrefix = "sim",
}: {
  onDone?: (conversationId: string) => void;
  idPrefix?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "");
    const input = {
      name: name.trim() === "" ? null : name,
      phone: String(fd.get("phone") ?? ""),
      text: String(fd.get("text") ?? ""),
    };
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      const result = await simulateInbound(input);
      if (!result.ok) {
        const fe: FieldErrors = {};
        for (const k of ["name", "phone", "text"] as const) {
          const m = result.fieldErrors?.[k]?.[0];
          if (m) fe[k] = m;
        }
        if (Object.keys(fe).length > 0) {
          setErrors(fe);
          return;
        }
        setFormError(result.error);
        toast.error(result.error);
        return;
      }
      form.reset();
      toast.success(
        <span>
          Mensagem simulada.{" "}
          <Link className="underline" href={`/inbox?c=${result.data.conversationId}`}>
            Abrir no Inbox
          </Link>
        </span>,
      );
      router.refresh();
      onDone?.(result.data.conversationId);
    });
  }

  const aria = (key: keyof FieldErrors) => ({
    id: `${idPrefix}-${key}`,
    name: key,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? `${idPrefix}-${key}-error` : undefined,
  });

  const fieldError = (key: keyof FieldErrors) =>
    errors[key] ? (
      <p id={`${idPrefix}-${key}-error`} className="text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null;

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Nome</Label>
        <Input {...aria("name")} autoComplete="off" />
        {fieldError("name")}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-phone`}>Telefone</Label>
        <Input {...aria("phone")} inputMode="tel" autoComplete="off" />
        {fieldError("phone")}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-text`}>Mensagem</Label>
        <textarea
          {...aria("text")}
          rows={3}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
        />
        {fieldError("text")}
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
        Simular mensagem recebida
      </Button>
    </form>
  );
}

export function SimulateDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (conversationId: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simular mensagem</DialogTitle>
          <DialogDescription>Cria uma mensagem recebida pelo canal Simulador.</DialogDescription>
        </DialogHeader>
        <SimulateForm
          idPrefix="simdlg"
          onDone={(id) => {
            onOpenChange(false);
            onDone?.(id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
