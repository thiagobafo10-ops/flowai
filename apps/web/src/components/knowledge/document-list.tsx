"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { deleteKnowledgeDocument, getAiStatus, reprocessKnowledgeDocument } from "@/lib/ai/actions";
import { KNOWLEDGE_STATUS_LABEL } from "@/lib/ai/messages";
import type { KnowledgeDocumentRow } from "@/lib/ai/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DocumentDialog } from "./document-dialog";

type Payload = { documents: KnowledgeDocumentRow[]; canWrite: boolean };

async function fetchDocuments(): Promise<Payload> {
  const response = await fetch("/api/conhecimento", { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar os documentos.");
  return response.json() as Promise<Payload>;
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function DocumentList({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["knowledge", orgId], queryFn: fetchDocuments });
  const status = useQuery({
    queryKey: ["ai-status", orgId],
    queryFn: async () => {
      const result = await getAiStatus();
      if (!result.ok) throw new Error(result.error);
      return result.data;
    },
    staleTime: 60_000,
  });
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KnowledgeDocumentRow | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeDocumentRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const refresh = () => void client.invalidateQueries({ queryKey: ["knowledge"] });

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Carregando documentos" className="space-y-3">
        <div className="h-8 animate-pulse rounded-lg bg-muted" />
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/60" />)}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-6">
        <p>Não foi possível carregar os documentos.</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  const { documents, canWrite } = query.data;
  const notConfigured = status.data?.configured === false;

  function reprocess(doc: KnowledgeDocumentRow) {
    startTransition(async () => {
      const result = await reprocessKnowledgeDocument(doc.id);
      if (!result.ok) toast.error(result.error);
      else toast.success("Reprocessamento iniciado.");
      refresh();
    });
  }
  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteKnowledgeDocument(target.id);
      if (!result.ok) {
        setDeleteError(result.error);
        toast.error(result.error);
        refresh();
        return;
      }
      toast.success("Documento excluído.");
      setDeleting(null);
      refresh();
    });
  }

  const newButton = canWrite ? (
    <Button type="button" onClick={() => setCreating(true)}>
      <PlusIcon />
      Novo documento
    </Button>
  ) : null;

  return (
    <div className="space-y-4">
      {status.isError && (
        <p className="text-sm text-muted-foreground">Não foi possível verificar a configuração da IA.</p>
      )}
      {notConfigured && (
        <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          IA não configurada na plataforma. Os documentos serão indexados quando a chave for configurada.
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">{documents.length === 1 ? "1 documento" : `${documents.length} documentos`}</p>
        {newButton}
      </div>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <p className="max-w-prose font-medium">
            Nenhum documento ainda. Adicione FAQs, políticas e informações de produtos para a IA responder com base nelas.
          </p>
          {newButton}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Título</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Trechos</th>
                <th scope="col" className="px-3 py-2 font-medium">Atualizado em</th>
                {canWrite && <th scope="col" className="px-3 py-2 text-right font-medium"><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{d.title}</td>
                  <td className="px-3 py-2">
                    <span>{KNOWLEDGE_STATUS_LABEL[d.status] ?? d.status}</span>
                    {d.status === "error" && d.error && <span className="block text-destructive">{d.error}</span>}
                  </td>
                  <td className="px-3 py-2">{d.chunkCount} {d.chunkCount === 1 ? "trecho" : "trechos"}</td>
                  <td className="px-3 py-2">{dateFormat.format(new Date(d.updatedAt))}</td>
                  {canWrite && (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" aria-label={`Editar ${d.title}`} onClick={() => setEditing(d)}>
                          <PencilIcon />
                          Editar
                        </Button>
                        <Button type="button" variant="outline" size="sm" aria-label={`Reprocessar ${d.title}`} disabled={pending || d.status === "processing"} onClick={() => reprocess(d)}>
                          <RefreshCwIcon />
                          Reprocessar
                        </Button>
                        <Button type="button" variant="outline" size="sm" aria-label={`Excluir ${d.title}`} onClick={() => { setDeleteError(null); setDeleting(d); }}>
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

      {canWrite && (
        <>
          <DocumentDialog orgId={orgId} open={creating} onClose={() => setCreating(false)} />
          <DocumentDialog orgId={orgId} open={!!editing} document={editing ?? undefined} onClose={() => setEditing(null)} />
          <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirmar exclusão</DialogTitle>
                <DialogDescription>Excluir documento? Os trechos indexados também serão removidos.</DialogDescription>
              </DialogHeader>
              {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDeleting(null)}>Cancelar</Button>
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
