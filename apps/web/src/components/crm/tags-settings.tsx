"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { TAG_COLORS, tagSchema, type TagColor, type TagInput } from "@flowai/core";
import { applyFieldErrors } from "@/lib/apply-field-errors";
import { createTag, deleteTag, updateTag } from "@/lib/crm/tag-actions";
import type { TagOption } from "@/lib/crm/queries";
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
import { TagBadge } from "./tag-badge";

const TAG_COLOR_LABELS: Record<TagColor, string> = {
  slate: "Cinza",
  red: "Vermelho",
  amber: "Âmbar",
  green: "Verde",
  teal: "Verde-azulado",
  blue: "Azul",
  indigo: "Índigo",
  pink: "Rosa",
};

type FormValues = z.input<typeof tagSchema>;

function TagForm({
  tag,
  onClose,
}: {
  /** Presente na edição. */
  tag?: TagOption;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues, unknown, TagInput>({
    resolver: zodResolver(tagSchema),
    defaultValues: { name: tag?.name ?? "", color: tag?.color ?? "slate" },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = tag ? await updateTag(tag.id, values) : await createTag(values);
      if (!result.ok) {
        // Erros de campo: só inline. Erros gerais: inline + toast.
        if (applyFieldErrors(setError, result.fieldErrors)) return;
        setFormError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Tag salva.");
      router.refresh();
      onClose();
    });
  });

  const nameError = errors.name?.message;
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="tag-name">Nome</Label>
        <Input
          id="tag-name"
          autoComplete="off"
          aria-invalid={!!nameError}
          aria-describedby={nameError ? "name-error" : undefined}
          {...register("name")}
        />
        {nameError && (
          <p id="name-error" className="text-sm text-destructive">
            {nameError}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tag-color">Cor</Label>
        <select id="tag-color" className={selectClassName} {...register("color")}>
          {TAG_COLORS.map((c) => (
            <option key={c} value={c}>
              {TAG_COLOR_LABELS[c]}
            </option>
          ))}
        </select>
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

export function TagsSettings({
  tags,
  canCreate,
  canManage,
}: {
  tags: TagOption[];
  canCreate: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TagOption | null>(null);
  const [deleting, setDeleting] = useState<TagOption | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const newButton = canCreate ? (
    <Button type="button" onClick={() => setCreating(true)}>
      <PlusIcon />
      Nova tag
    </Button>
  ) : null;

  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteTag(target.id);
      if (!result.ok) {
        setDeleteError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Tag excluída.");
      setDeleting(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">{tags.length === 1 ? "1 tag" : `${tags.length} tags`}</p>
        {newButton}
      </div>

      {tags.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">Nenhuma tag ainda</p>
          {newButton}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Nome</th>
                <th scope="col" className="px-3 py-2 font-medium">Cor</th>
                <th scope="col" className="px-3 py-2 font-medium">Contatos</th>
                {canManage && (
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">Ações</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {tags.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="px-3 py-2">
                    <TagBadge name={t.name} color={t.color} />
                  </td>
                  <td className="px-3 py-2">{TAG_COLOR_LABELS[t.color]}</td>
                  <td className="px-3 py-2">{t.contactCount}</td>
                  {canManage && (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(t)}>
                          <PencilIcon />
                          Editar
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(t);
                          }}
                        >
                          <Trash2Icon />
                          Excluir
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCreate && (
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova tag</DialogTitle>
              <DialogDescription>Escolha um nome e uma cor.</DialogDescription>
            </DialogHeader>
            {creating && <TagForm onClose={() => setCreating(false)} />}
          </DialogContent>
        </Dialog>
      )}

      {canManage && (
        <>
          <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Editar tag</DialogTitle>
                <DialogDescription>Altere o nome ou a cor da tag.</DialogDescription>
              </DialogHeader>
              {editing && <TagForm key={editing.id} tag={editing} onClose={() => setEditing(null)} />}
            </DialogContent>
          </Dialog>

          <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Excluir tag?</DialogTitle>
                <DialogDescription>
                  Excluir a tag {deleting?.name}? Ela será removida de todos os contatos.
                </DialogDescription>
              </DialogHeader>
              {deleteError && (
                <p role="alert" className="text-sm text-destructive">
                  {deleteError}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
                  Cancelar
                </Button>
                <Button type="button" variant="destructive" disabled={pending} onClick={confirmDelete}>
                  {pending && <Loader2Icon className="animate-spin" />}
                  Excluir
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
