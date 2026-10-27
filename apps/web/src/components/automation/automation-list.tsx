"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, Loader2Icon, PauseIcon, PencilIcon, PlayIcon, PlusIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { automationTemplates } from "@flowai/core";
import { AutomationAiDialog } from "./ai-dialog";
import {
  activateAutomation, createAutomation, deleteAutomation, duplicateAutomation, pauseAutomation,
} from "@/lib/automation/actions";
import {
  AUTOMATION_ACTIVATED, AUTOMATION_DELETED, AUTOMATION_DUPLICATED, AUTOMATION_PAUSED, AUTOMATION_STATUS_LABEL, AUTOMATION_TRIGGER_LABEL, TEMPLATE_DESCRIPTIONS, automationActivateBlocked,
} from "@/lib/automation/messages";
import type { AutomationRow } from "@/lib/automation/queries";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Payload = { automations: AutomationRow[]; canWrite: boolean };
type TemplateKey = (typeof automationTemplates)[number]["key"];

async function fetchAutomations(): Promise<Payload> {
  const response = await fetch("/api/automacoes", { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar as automações.");
  return response.json() as Promise<Payload>;
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function AutomationList({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: ["automations", orgId], queryFn: fetchAutomations });
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AutomationRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const refresh = () => void client.invalidateQueries({ queryKey: ["automations", orgId] });

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Carregando automações" className="space-y-3">
        <div className="h-8 animate-pulse rounded-lg bg-muted" />
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted/60" />)}
      </div>
    );
  }
  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-6">
        <p>Não foi possível carregar as automações.</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  const { automations, canWrite } = query.data;

  function create(templateKey?: TemplateKey) {
    setCreateError(null);
    startTransition(async () => {
      const result = await createAutomation(templateKey ? { templateKey } : {});
      if (!result.ok) {
        setCreateError(result.error);
        toast.error(result.error);
        return;
      }
      setCreating(false);
      refresh();
      router.push(`/automacoes/${result.data.id}`);
    });
  }
  function toggle(a: AutomationRow) {
    startTransition(async () => {
      if (a.status === "active") {
        const result = await pauseAutomation(a.id);
        if (!result.ok) toast.error(result.error);
        else toast.success(AUTOMATION_PAUSED);
      } else {
        const result = await activateAutomation(a.id);
        if (!result.ok) toast.error(result.error);
        else if (!result.data.activated) toast.error(automationActivateBlocked(result.data.issues.length));
        else toast.success(AUTOMATION_ACTIVATED);
      }
      refresh();
    });
  }
  function duplicate(a: AutomationRow) {
    startTransition(async () => {
      const result = await duplicateAutomation(a.id);
      if (!result.ok) toast.error(result.error);
      else toast.success(AUTOMATION_DUPLICATED);
      refresh();
    });
  }
  function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteAutomation(target.id);
      if (!result.ok) {
        setDeleteError(result.error);
        toast.error(result.error);
        refresh();
        return;
      }
      toast.success(AUTOMATION_DELETED);
      setDeleting(null);
      refresh();
    });
  }

  const templateCards = (
    <div className="grid w-full gap-3 sm:grid-cols-2 md:grid-cols-4">
      <button
        type="button"
        disabled={pending || !canWrite}
        onClick={() => {
          setCreating(false);
          setTimeout(() => setAiOpen(true), 60);
        }}
        className="group flex flex-col justify-between rounded-xl border border-primary/30 bg-primary/5 p-4 text-left transition-all hover:border-primary/50 hover:bg-primary/10 disabled:opacity-60"
      >
        <div>
          <div className="flex items-center gap-1.5 font-medium text-primary">
            <SparklesIcon className="size-4" />
            <span>Criar com IA</span>
          </div>
          <span className="mt-1 block text-xs text-muted-foreground">
            Descreva seu fluxo em português e a IA estruturará todos os blocos.
          </span>
        </div>
        <span className="mt-3 text-xs font-semibold text-primary underline-offset-2 group-hover:underline">
          Experimentar →
        </span>
      </button>
      {automationTemplates.map((t) => (
        <button
          key={t.key}
          type="button"
          disabled={pending || !canWrite}
          onClick={() => create(t.key)}
          className="rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
        >
          <span className="block font-medium">{t.name}</span>
          <span className="block text-sm text-muted-foreground">{TEMPLATE_DESCRIPTIONS[t.key]}</span>
        </button>
      ))}
    </div>
  );

  const newButton = canWrite ? (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => setAiOpen(true)}
        className="gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
      >
        <SparklesIcon className="size-4" />
        Criar com IA
      </Button>
      <Button type="button" onClick={() => { setCreateError(null); setCreating(true); }}>
        <PlusIcon />
        Nova automação
      </Button>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">{automations.length === 1 ? "1 automação" : `${automations.length} automações`}</p>
        {newButton}
      </div>
      {!canWrite && <p className="text-sm text-muted-foreground">Somente administradores podem criar ou alterar automações.</p>}

      {automations.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-10 text-center">
          <p className="max-w-prose font-medium">Nenhuma automação ainda. Comece por um modelo:</p>
          {templateCards}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Nome</th>
                <th scope="col" className="px-3 py-2 font-medium">Gatilho</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Execuções (7 dias)</th>
                <th scope="col" className="px-3 py-2 font-medium">Cliques (7 dias)</th>
                <th scope="col" className="px-3 py-2 font-medium">Contatos (7 dias)</th>
                <th scope="col" className="px-3 py-2 font-medium">Atualizada em</th>
                {canWrite && <th scope="col" className="px-3 py-2 text-right font-medium"><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {automations.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-3 py-2 font-medium">
                    <span className="flex items-center gap-2">
                      {a.name}
                      {a.createdByClaude && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
                          <SparklesIcon className="size-3" aria-hidden="true" />
                          Criada pelo Claude
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2">{AUTOMATION_TRIGGER_LABEL[a.triggerType] ?? a.triggerType}</td>
                  <td className="px-3 py-2">{AUTOMATION_STATUS_LABEL[a.status] ?? a.status}</td>
                  <td className="px-3 py-2">{a.runs7d}</td>
                  <td className="px-3 py-2">{a.clicks7d}</td>
                  <td className="px-3 py-2">{a.contacts7d}</td>
                  <td className="px-3 py-2">{dateFormat.format(new Date(a.updatedAt))}</td>
                  {canWrite && (
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        <Link href={`/automacoes/${a.id}`} aria-label={`Editar ${a.name}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                          <PencilIcon />
                          Editar
                        </Link>
                        <Button type="button" variant="outline" size="sm" aria-label={`Duplicar ${a.name}`} disabled={pending} onClick={() => duplicate(a)}>
                          <CopyIcon />
                          Duplicar
                        </Button>
                        <Button type="button" variant="outline" size="sm" aria-label={`${a.status === "active" ? "Pausar" : "Ativar"} ${a.name}`} disabled={pending} onClick={() => toggle(a)}>
                          {a.status === "active" ? <PauseIcon /> : <PlayIcon />}
                          {a.status === "active" ? "Pausar" : "Ativar"}
                        </Button>
                        <Button type="button" variant="outline" size="sm" aria-label={`Excluir ${a.name}`} disabled={pending} onClick={() => { setDeleteError(null); setDeleting(a); }}>
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
          <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova automação</DialogTitle>
                <DialogDescription>Comece em branco ou por um modelo.</DialogDescription>
              </DialogHeader>
              <Button type="button" variant="outline" disabled={pending} onClick={() => create()}>
                {pending && <Loader2Icon className="animate-spin" />}
                Em branco
              </Button>
              {templateCards}
              {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreating(false)}>Cancelar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirmar exclusão</DialogTitle>
                <DialogDescription>Excluir automação? As execuções em andamento serão canceladas.</DialogDescription>
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
          <AutomationAiDialog open={aiOpen} onOpenChange={setAiOpen} />
        </>
      )}
    </div>
  );
}
