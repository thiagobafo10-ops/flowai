"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { simulateEntryLink } from "@/lib/growth/actions";
import type { EntryLinkItem } from "@/lib/growth/queries";
import { simulateInbound } from "@/lib/inbox/channel-actions";
import { cn } from "@/lib/utils";
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
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
        Simular mensagem recebida
      </Button>
    </form>
  );
}

/** Formulário para simular abertura por link de entrada no canal Simulador. */
export function SimulateLinkOpenForm({
  onDone,
  idPrefix = "simlink",
}: {
  onDone?: (conversationId: string) => void;
  idPrefix?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Partial<Record<"linkId" | "phone" | "name", string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["simulator-links"],
    queryFn: async () => {
      const res = await fetch("/api/links", { cache: "no-store" });
      if (!res.ok) throw new Error("Não foi possível carregar os links.");
      return res.json() as Promise<{ links: EntryLinkItem[] }>;
    },
  });

  const links = useMemo(
    () =>
      query.data?.links.filter(
        (l) => l.status === "active" && l.channel?.type === "simulator",
      ) ?? [],
    [query.data?.links],
  );

  const [selectedLinkId, setSelectedLinkId] = useState<string>("");
  const activeLinkId = selectedLinkId || (links[0]?.id ?? "");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const linkId = String(fd.get("linkId") ?? activeLinkId);
    const phone = String(fd.get("phone") ?? "");
    const name = String(fd.get("name") ?? "");

    setErrors({});
    setFormError(null);

    startTransition(async () => {
      const result = await simulateEntryLink({
        linkId,
        phone,
        name,
      });

      if (!result.ok) {
        if (result.fieldErrors) {
          const fe: Partial<Record<"linkId" | "phone" | "name", string>> = {};
          if (result.fieldErrors.linkId?.[0]) fe.linkId = result.fieldErrors.linkId[0];
          if (result.fieldErrors.phone?.[0]) fe.phone = result.fieldErrors.phone[0];
          if (result.fieldErrors.name?.[0]) fe.name = result.fieldErrors.name[0];
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
          Abertura por link simulada.{" "}
          <Link className="underline" href={`/inbox?c=${result.data.conversationId}`}>
            Abrir no Inbox
          </Link>
        </span>,
      );
      router.refresh();
      onDone?.(result.data.conversationId);
    });
  }

  if (query.isPending) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className="space-y-3 py-2 text-sm">
        <p className="text-muted-foreground">
          Nenhum link ativo encontrado para o canal Simulador.
        </p>
        <p className="text-xs text-muted-foreground">
          Crie um link no canal Simulador em{" "}
          <Link href="/automacoes/links" className="underline font-medium text-foreground">
            Automações &gt; Links de entrada
          </Link>{" "}
          para testar a abertura.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-link`}>Link de entrada</Label>
        <select
          id={`${idPrefix}-link`}
          name="linkId"
          value={activeLinkId}
          onChange={(e) => setSelectedLinkId(e.target.value)}
          disabled={pending}
          className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {links.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.code})
            </option>
          ))}
        </select>
        {errors.linkId && <p className="text-sm text-destructive">{errors.linkId}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-phone`}>Telefone do contato</Label>
        <Input
          id={`${idPrefix}-phone`}
          name="phone"
          placeholder="Ex: 5511999999999"
          inputMode="tel"
          autoComplete="off"
          required
          disabled={pending}
        />
        {errors.phone && <p className="text-sm text-destructive">{errors.phone}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-name`}>Nome do contato (opcional)</Label>
        <Input
          id={`${idPrefix}-name`}
          name="name"
          placeholder="Ex: Ana Silva"
          autoComplete="off"
          disabled={pending}
        />
        {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <Loader2Icon className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
        Simular abertura por link
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
  const [mode, setMode] = useState<"message" | "link">("message");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Simulador de atendimento</DialogTitle>
          <DialogDescription>
            Simule interações de clientes pelo canal Simulador.
          </DialogDescription>
        </DialogHeader>

        <div className="flex rounded-lg border bg-muted/40 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("message")}
            className={cn(
              "flex-1 rounded-md py-1.5 font-medium transition-colors",
              mode === "message"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Mensagem recebida
          </button>
          <button
            type="button"
            onClick={() => setMode("link")}
            className={cn(
              "flex-1 rounded-md py-1.5 font-medium transition-colors",
              mode === "link"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Abertura por link
          </button>
        </div>

        {mode === "message" ? (
          <SimulateForm
            idPrefix="simdlg"
            onDone={(id) => {
              onOpenChange(false);
              onDone?.(id);
            }}
          />
        ) : (
          <SimulateLinkOpenForm
            idPrefix="simlinkdlg"
            onDone={(id) => {
              onOpenChange(false);
              onDone?.(id);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
