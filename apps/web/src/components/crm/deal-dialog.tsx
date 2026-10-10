"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useForm, type Resolver } from "react-hook-form";
import type { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { dealSchema, defaultDealTitle, type DealInput } from "@flowai/core";
import {
  createDeal,
  deleteDeal,
  searchDealContacts,
  updateDeal,
  type DealContactOption,
} from "@/lib/crm/deal-actions";
import type { BoardDeal, BoardStage } from "@/lib/crm/queries";
import { applyFieldErrors } from "@/lib/apply-field-errors";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectClassName } from "./contact-dialog";

type FormValues = z.input<typeof dealSchema>;

export type DealDialogState =
  | { mode: "create"; stageId: string; contact: { id: string; name: string } | null }
  | { mode: "edit"; deal: BoardDeal };

type Props = {
  state: DealDialogState | null;
  onClose: () => void;
  /** Chamado após qualquer gravação (ou falha em edição) para atualizar o quadro. */
  onChanged: () => void;
  stages: BoardStage[];
  members: { userId: string; name: string }[];
  canWrite: boolean;
  canDelete: boolean;
};

export function DealDialog({ state, onClose, ...rest }: Props) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.mode === "create" ? "Novo deal" : "Deal"}</DialogTitle>
          <DialogDescription>
            {rest.canWrite ? "Informe o contato, o título e o valor." : "Detalhes do deal (somente leitura)."}
          </DialogDescription>
        </DialogHeader>
        {/* Montado só com o diálogo aberto: o formulário sempre começa limpo. */}
        {state && <DealForm state={state} onClose={onClose} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}

function formatValueInput(v: number): string {
  return v.toFixed(2).replace(".", ",");
}

function DealForm({
  state,
  onClose,
  onChanged,
  stages,
  members,
  canWrite,
  canDelete,
}: Omit<Props, "state"> & { state: DealDialogState }) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isEdit = state.mode === "edit";
  const [contact, setContact] = useState<{ id: string; name: string } | null>(
    state.mode === "edit" ? { id: state.deal.contact.id, name: state.deal.contact.name } : state.contact,
  );

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, dirtyFields },
  } = useForm<FormValues, unknown, DealInput>({
    resolver: zodResolver(dealSchema) as Resolver<FormValues, unknown, DealInput>,
    defaultValues:
      state.mode === "edit"
        ? {
            contactId: state.deal.contact.id,
            title: state.deal.title,
            value: formatValueInput(state.deal.value),
            ownerId: state.deal.ownerId ?? "",
            stageId: state.deal.stageId,
          }
        : {
            contactId: state.contact?.id ?? "",
            title: state.contact ? defaultDealTitle(state.contact.name) : "",
            value: "",
            ownerId: "",
            stageId: state.stageId,
          },
  });

  function pickContact(c: { id: string; name: string }) {
    setContact(c);
    setValue("contactId", c.id, { shouldValidate: true });
    // Título padrão enquanto a pessoa não o editou.
    if (!dirtyFields.title) setValue("title", defaultDealTitle(c.name));
  }

  function clearContact() {
    setContact(null);
    setValue("contactId", "");
  }

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result =
        state.mode === "edit" ? await updateDeal(state.deal.id, values) : await createDeal(values);
      if (!result.ok) {
        if (isEdit) onChanged();
        if (applyFieldErrors(setError, result.fieldErrors)) return;
        setFormError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Deal salvo.");
      onChanged();
      onClose();
    });
  });

  function onDelete() {
    if (state.mode !== "edit") return;
    setFormError(null);
    startTransition(async () => {
      const result = await deleteDeal(state.deal.id);
      if (!result.ok) {
        onChanged();
        setConfirmingDelete(false);
        setFormError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Deal excluído.");
      onChanged();
      onClose();
    });
  }

  const field = (name: keyof FormValues) => ({
    "aria-invalid": !!errors[name],
    "aria-describedby": errors[name] ? `deal-${name}-error` : undefined,
  });
  const fieldError = (name: keyof FormValues) =>
    errors[name] ? (
      <p id={`deal-${name}-error`} className="text-sm text-destructive">
        {name === "contactId" ? "Selecione um contato." : String(errors[name]?.message ?? "")}
      </p>
    ) : null;

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <fieldset disabled={!canWrite || pending} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="deal-contact">Contato</Label>
          {contact ? (
            <div id="deal-contact" className="flex items-center justify-between gap-2 text-sm">
              {isEdit ? (
                <Link href={`/contatos/${contact.id}`} className="font-medium underline underline-offset-2">
                  {contact.name}
                </Link>
              ) : (
                <span className="font-medium">{contact.name}</span>
              )}
              {!isEdit && canWrite && (
                <Button type="button" variant="ghost" size="sm" onClick={clearContact}>
                  Trocar contato
                </Button>
              )}
            </div>
          ) : (
            <ContactPicker onPick={pickContact} invalid={!!errors.contactId} />
          )}
          {fieldError("contactId")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-title">Título</Label>
          <Input id="deal-title" autoComplete="off" {...field("title")} {...register("title")} />
          {fieldError("title")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="deal-value">Valor</Label>
            <Input
              id="deal-value"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              {...field("value")}
              {...register("value")}
            />
            {fieldError("value")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deal-owner">Responsável</Label>
            <select id="deal-owner" className={selectClassName} {...field("ownerId")} {...register("ownerId")}>
              <option value="">Sem responsável</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
            {fieldError("ownerId")}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-stage">Etapa</Label>
          <select id="deal-stage" className={selectClassName} {...field("stageId")} {...register("stageId")}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {fieldError("stageId")}
        </div>
      </fieldset>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      {!canWrite ? (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      ) : confirmingDelete ? (
        <DialogFooter>
          <p className="mr-auto self-center text-sm">Excluir este deal? Esta ação não pode ser desfeita.</p>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setConfirmingDelete(false)}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onDelete}>
            {pending && <Loader2Icon className="animate-spin" />}
            Confirmar exclusão
          </Button>
        </DialogFooter>
      ) : (
        <DialogFooter>
          {isEdit && canDelete && (
            <Button
              type="button"
              variant="destructive"
              className="sm:mr-auto"
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
            >
              Excluir deal
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      )}
    </form>
  );
}

function ContactPicker({
  onPick,
  invalid,
}: {
  onPick: (c: { id: string; name: string }) => void;
  invalid: boolean;
}) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<DealContactOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  // Busca com atraso; respostas atrasadas são descartadas.
  useEffect(() => {
    const id = ++seq.current;
    const t = setTimeout(async () => {
      const result = await searchDealContacts(q);
      if (id !== seq.current) return;
      if (result.ok) {
        setOptions(result.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-2">
      <Input
        id="deal-contact"
        type="search"
        autoComplete="off"
        placeholder="Buscar por nome, telefone ou e-mail"
        maxLength={100}
        aria-invalid={invalid}
        aria-describedby={invalid ? "deal-contactId-error" : undefined}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {failed ? (
        <p role="status" className="text-sm text-muted-foreground">
          Não foi possível buscar contatos.
        </p>
      ) : options === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          Buscando…
        </p>
      ) : options.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Nenhum contato encontrado.
        </p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                disabled={o.hasOpenDeal}
                onClick={() => onPick({ id: o.id, name: o.name })}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span>
                  {o.name}
                  {o.detail && <span className="text-muted-foreground"> · {o.detail}</span>}
                </span>
                {o.hasOpenDeal && <span className="text-xs text-muted-foreground">já tem deal aberto</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
