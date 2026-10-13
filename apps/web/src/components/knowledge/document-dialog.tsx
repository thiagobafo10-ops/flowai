"use client";

import { useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { knowledgeDocumentSchema, type KnowledgeDocumentInput } from "@flowai/core";
import { applyFieldErrors } from "@/lib/apply-field-errors";
import { getKnowledgeDocument, saveKnowledgeDocument } from "@/lib/ai/actions";
import { readTextFile } from "@/lib/ai/file";
import type { KnowledgeDocumentRow } from "@/lib/ai/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormValues = z.input<typeof knowledgeDocumentSchema>;

type Initial = { id?: string; title: string; content: string };

function DocumentForm({ initial, onClose }: { initial: Initial; onClose: () => void }) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, setValue, getValues, formState: { errors } } = useForm<FormValues, unknown, KnowledgeDocumentInput>({
    resolver: zodResolver(knowledgeDocumentSchema),
    defaultValues: { title: initial.title, content: initial.content },
  });

  const documentId = initial.id;

  async function onFile(file: File | undefined) {
    if (!file) return;
    const result = await readTextFile(file);
    if (fileInput.current) fileInput.current.value = "";
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setFormError(null);
    setValue("content", result.text, { shouldValidate: true });
    if (!getValues("title").trim()) setValue("title", file.name.replace(/\.[^.]+$/, ""), { shouldValidate: true });
  }

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await saveKnowledgeDocument({ id: documentId, ...values });
      if (!result.ok) {
        if (applyFieldErrors(setError, result.fieldErrors)) return;
        setFormError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Documento salvo. A indexação começou.");
      void client.invalidateQueries({ queryKey: ["knowledge"] });
      onClose();
    });
  });

  const titleError = errors.title?.message;
  const contentError = errors.content?.message;
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="doc-title">Título</Label>
        <Input id="doc-title" autoComplete="off" aria-invalid={!!titleError} aria-describedby={titleError ? "doc-title-error" : undefined} {...register("title")} />
        {titleError && <p id="doc-title-error" className="text-sm text-destructive">{titleError}</p>}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="doc-content">Conteúdo</Label>
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => fileInput.current?.click()}>
            <UploadIcon />
            Carregar arquivo .txt/.md
          </Button>
          <input ref={fileInput} type="file" accept=".txt,.md,text/plain,text/markdown" className="sr-only" aria-label="Arquivo .txt ou .md" tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        <textarea
          id="doc-content"
          rows={12}
          className="w-full rounded-lg border bg-transparent p-2 text-sm"
          aria-invalid={!!contentError}
          aria-describedby={contentError ? "doc-content-error" : undefined}
          {...register("content")}
        />
        {contentError && <p id="doc-content-error" className="text-sm text-destructive">{contentError}</p>}
      </div>
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditLoader({ orgId, document, onClose }: { orgId: string; document: KnowledgeDocumentRow; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["knowledge", orgId, "document", document.id],
    queryFn: async () => {
      const result = await getKnowledgeDocument(document.id);
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  if (query.isPending) return <p aria-busy="true" className="text-sm text-muted-foreground">Carregando documento…</p>;
  if (query.isError) {
    return (
      <div role="alert" className="space-y-3">
        <p className="text-sm text-destructive">{query.error.message}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    );
  }
  return <DocumentForm initial={query.data} onClose={onClose} />;
}

/** `document` indefinido com `open` = novo documento. */
export function DocumentDialog({ orgId, open, document, onClose }: { orgId: string; open: boolean; document?: KnowledgeDocumentRow; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{document ? "Editar documento" : "Novo documento"}</DialogTitle>
          <DialogDescription>Digite o texto ou carregue um arquivo .txt/.md de até 1 MB. O arquivo não é armazenado.</DialogDescription>
        </DialogHeader>
        {open && (document
          ? <EditLoader key={document.id} orgId={orgId} document={document} onClose={onClose} />
          : <DocumentForm key="new" initial={{ title: "", content: "" }} onClose={onClose} />)}
      </DialogContent>
    </Dialog>
  );
}
