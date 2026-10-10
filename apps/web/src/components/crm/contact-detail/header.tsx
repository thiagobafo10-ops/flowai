"use client";

import { useState, useTransition } from "react";
import { Loader2Icon, PencilIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { CONTACT_STATUS_LABELS, type ContactInput, type ContactStatus } from "@flowai/core";
import { deleteContact } from "@/lib/crm/contact-actions";
import { initials } from "@/lib/crm/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ContactDialog, type DialogMember } from "../contact-dialog";
import type { PickerTag } from "../tag-picker";

const STATUS_CLASSES: Record<ContactStatus, string> = {
  lead: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  customer: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200",
  inactive: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

type Props = {
  contactId: string;
  displayName: string;
  status: ContactStatus;
  leadScore: number;
  assigneeName: string | null;
  canEdit: boolean;
  canDelete: boolean;
  allTags: PickerTag[];
  members: DialogMember[];
  values: ContactInput;
};

export function ContactHeader({
  contactId,
  displayName,
  status,
  leadScore,
  assigneeName,
  canEdit,
  canDelete,
  allTags,
  members,
  values,
}: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      // Em sucesso a action faz redirect('/contatos'); só volta aqui em caso de erro.
      const result = await deleteContact(contactId);
      if (result && !result.ok) {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <header className="flex flex-wrap items-center gap-4">
      <span
        aria-hidden="true"
        className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-lg font-medium text-muted-foreground"
      >
        {initials(displayName)}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <h1 className="truncate text-2xl font-semibold">{displayName}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASSES[status])}>
            {CONTACT_STATUS_LABELS[status]}
          </span>
          <span>Lead score: {leadScore}</span>
          <span>Responsável: {assigneeName ?? "—"}</span>
        </div>
      </div>
      <div className="flex gap-2">
        {canEdit && (
          <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
            <PencilIcon />
            Editar
          </Button>
        )}
        {canDelete && (
          <Button type="button" variant="outline" onClick={() => setDeleteOpen(true)}>
            <Trash2Icon />
            Excluir
          </Button>
        )}
      </div>

      {canEdit && (
        <ContactDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          tags={allTags}
          members={members}
          contact={{ id: contactId, values }}
        />
      )}
      {canDelete && (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Excluir contato?</DialogTitle>
              <DialogDescription>
                Esta ação não pode ser desfeita. Tags, campos e deals do contato também serão removidos.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" disabled={pending} onClick={confirmDelete}>
                {pending && <Loader2Icon className="animate-spin" />}
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </header>
  );
}
