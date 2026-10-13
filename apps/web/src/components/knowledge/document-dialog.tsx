"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import type { z } from "zod";
import { knowledgeDocumentSchema, type KnowledgeDocumentInput } from "@flowai/core";
import { applyFieldErrors } from "@/lib/apply-field-errors";
import { saveKnowledgeDocument } from "@/lib/ai/actions";
import { readTextFile } from "@/lib/ai/file";
import type { KnowledgeDocumentRow } from "@/lib/ai/queries";
import { createBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormValues = z.input<typeof knowledgeDocumentSchema>;

function DocumentForm({ document, onClose }: { document?: KnowledgeDocumentRow; onClose: () => void }) {
  const client = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(Boolean(document));
  const { register, handleSubmit, setError, setValue, getValues, formState: { errors } } = useForm<FormValues, unknown, KnowledgeDocumentInput>({
    resolver: zodResolver(knowledgeDocumentSchema),
    defaultValues: { title: document?.title ?? "", content: "" },
  });

  // A listagem não traz o conteúdo; na edição ele é lido sob demanda (RLS limita ao admin).
  const documentId = document?.id;
  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    void createBrowserClient()
      .from("knowledge_documents")
      .select("content")
      .eq("id", documentId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setValue("content", data.content);
        else setFormError("Não foi possível carregar o conteúdo do documento.");
        setLoadingContent(false);
      });
    return () => { cancelled = true; };
  }, [documentId, setValue]);

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
          disabled={loadingContent}
          placeholder={loadingContent ? "Carregando…" : undefined}
          aria-invalid={!!contentError}
          aria-describedby={contentError ? "doc-content-error" : undefined}
          {...register("content")}
        />
        {contentError && <p id="doc-content-error" className="text-sm text-destructive">{contentError}</p>}
      </div>
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={pending || loadingContent}>
          {pending && <Loader2Icon className="animate-spin" />}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

/** `document` indefinido com `open` = novo documento. */
export function DocumentDialog({ open, document, onClose }: { open: boolean; document?: KnowledgeDocumentRow; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{document ? "Editar documento" : "Novo documento"}</DialogTitle>
          <DialogDescription>Digite o texto ou carregue um arquivo .txt/.md de até 1 MB. O arquivo não é armazenado.</DialogDescription>
        </DialogHeader>
        {open && <DocumentForm key={document?.id ?? "new"} document={document} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
