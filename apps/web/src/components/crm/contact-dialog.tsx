"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import type { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { CONTACT_STATUS_LABELS, contactSchema, type ContactInput } from "@flowai/core";
import { saveContact } from "@/lib/crm/contact-actions";
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
import { TagPicker, type PickerTag } from "./tag-picker";

type FormValues = z.input<typeof contactSchema>;

export type DialogMember = { userId: string; name: string };

export const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tags: PickerTag[];
  members: DialogMember[];
  /** Presente na edição. */
  contact?: { id: string; values: ContactInput };
};

export function ContactDialog({ open, onOpenChange, ...rest }: Props) {
  const isEdit = !!rest.contact;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar contato" : "Novo contato"}</DialogTitle>
          <DialogDescription>
            Informe ao menos nome, telefone ou e-mail.
          </DialogDescription>
        </DialogHeader>
        {/* Montado só com o diálogo aberto: o formulário sempre começa limpo. */}
        <ContactForm {...rest} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// "Informe ao menos nome, telefone ou e-mail" vem sem caminho: mostra no campo Nome.
function withRootErrorOnName(base: Resolver<FormValues, unknown, ContactInput>) {
  const resolver: Resolver<FormValues, unknown, ContactInput> = async (values, ctx, opts) => {
    const result = await base(values, ctx, opts);
    const errors = result.errors as Record<string, unknown>;
    if (errors && errors[""] && !errors.name) {
      errors.name = errors[""];
      delete errors[""];
    }
    return result;
  };
  return resolver;
}

function ContactForm({
  tags: initialTags,
  members,
  contact,
  onClose,
}: Omit<Props, "open" | "onOpenChange"> & { onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [tags, setTags] = useState<PickerTag[]>(initialTags);
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null);

  const v = contact?.values;
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<FormValues, unknown, ContactInput>({
    resolver: withRootErrorOnName(zodResolver(contactSchema)),
    defaultValues: {
      name: v?.name ?? "",
      phone: v?.phone ?? "",
      email: v?.email ?? "",
      status: v?.status ?? "lead",
      assignedTo: v?.assignedTo ?? "",
      tagIds: v?.tagIds ?? [],
      leadScore: v?.leadScore ?? 0,
      customFields: v?.customFields ?? [],
    },
  });
  const tagIds = useWatch({ control, name: "tagIds" }) ?? [];

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveContact(contact?.id ?? null, values);
      if (!result.ok) {
        // Erros de campo: só inline. Erros gerais: inline + toast.
        if (applyFieldErrors(setError, result.fieldErrors)) return;
        setFormError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Contato salvo.");
      router.refresh();
      if (result.data.duplicateOf) {
        setDuplicate(result.data.duplicateOf);
      } else {
        onClose();
      }
    });
  });

  if (duplicate) {
    return (
      <div className="space-y-4">
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Já existe um contato com este telefone/e-mail:{" "}
          <Link href={`/contatos/${duplicate.id}`} className="font-medium underline underline-offset-2">
            {duplicate.name}
          </Link>
        </p>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Concluir
          </Button>
        </DialogFooter>
      </div>
    );
  }

  const field = (name: keyof FormValues) => ({
    "aria-invalid": !!errors[name],
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const fieldError = (name: keyof FormValues) =>
    errors[name]?.message ? (
      <p id={`${name}-error`} className="text-sm text-destructive">
        {String(errors[name]?.message)}
      </p>
    ) : null;

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="contact-name">Nome</Label>
        <Input id="contact-name" autoComplete="off" {...field("name")} {...register("name")} />
        {fieldError("name")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-phone">Telefone</Label>
          <Input id="contact-phone" type="tel" autoComplete="off" placeholder="(11) 99999-8888" {...field("phone")} {...register("phone")} />
          {fieldError("phone")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-email">E-mail</Label>
          <Input id="contact-email" type="email" autoComplete="off" {...field("email")} {...register("email")} />
          {fieldError("email")}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-status">Status</Label>
          <select id="contact-status" className={selectClassName} {...field("status")} {...register("status")}>
            {Object.entries(CONTACT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {fieldError("status")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-assignee">Responsável</Label>
          <select id="contact-assignee" className={selectClassName} {...field("assignedTo")} {...register("assignedTo")}>
            <option value="">Sem responsável</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
          {fieldError("assignedTo")}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="contact-score">Lead score</Label>
        <Input id="contact-score" type="number" inputMode="numeric" min={0} max={100} step={1} {...field("leadScore")} {...register("leadScore")} />
        {fieldError("leadScore")}
      </div>
      <div className="space-y-1.5">
        <Label>Tags</Label>
        <TagPicker
          tags={tags}
          selected={tagIds}
          onChange={(ids) => setValue("tagIds", ids, { shouldDirty: true })}
          onCreated={(t) => setTags((prev) => (prev.some((p) => p.id === t.id) ? prev : [...prev, t]))}
        />
      </div>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Botão "Novo contato" com o diálogo de criação. */
export function NewContactButton({
  tags,
  members,
  variant = "default",
}: {
  tags: PickerTag[];
  members: DialogMember[];
  variant?: "default" | "outline";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)}>
        <PlusIcon />
        Novo contato
      </Button>
      <ContactDialog open={open} onOpenChange={setOpen} tags={tags} members={members} />
    </>
  );
}
