"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3Icon,
  CalendarIcon,
  CheckCircle2Icon,
  ClockIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  StopCircleIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cancelCampaign, deleteCampaign, saveCampaignDraft } from "@/lib/growth/actions";
import { CAMPAIGN_STATUS_LABEL } from "@/lib/growth/messages";
import type { CampaignFilterRefs, CampaignListItem, CampaignStatus } from "@/lib/growth/queries";
import { Button, buttonVariants } from "@/components/ui/button";
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

type ApiData = {
  campaigns: CampaignListItem[];
  refs: CampaignFilterRefs;
  canWrite: boolean;
};

async function fetchCampaigns(): Promise<ApiData> {
  const res = await fetch("/api/campanhas", { cache: "no-store" });
  if (!res.ok) throw new Error("Não foi possível carregar as campanhas.");
  return res.json() as Promise<ApiData>;
}

const STATUS_CONFIG: Record<
  CampaignStatus,
  { label: string; bg: string; text: string; icon: typeof ClockIcon }
> = {
  draft: {
    label: "Rascunho",
    bg: "bg-muted text-muted-foreground border-muted-foreground/20",
    text: "text-muted-foreground",
    icon: PencilIcon,
  },
  scheduled: {
    label: "Agendada",
    bg: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    text: "text-blue-600 dark:text-blue-400",
    icon: CalendarIcon,
  },
  sending: {
    label: "Enviando",
    bg: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 animate-pulse",
    text: "text-amber-600 dark:text-amber-400",
    icon: SendIcon,
  },
  completed: {
    label: "Concluída",
    bg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    text: "text-emerald-600 dark:text-emerald-400",
    icon: CheckCircle2Icon,
  },
  cancelled: {
    label: "Cancelada",
    bg: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
    text: "text-rose-600 dark:text-rose-400",
    icon: XCircleIcon,
  },
};

export function CampaignsView({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: ["campaigns", orgId], queryFn: fetchCampaigns });

  const [createOpen, setCreateOpen] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [deletingCampaign, setDeletingCampaign] = useState<CampaignListItem | null>(null);
  const [cancellingCampaign, setCancellingCampaign] = useState<CampaignListItem | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["campaigns", orgId] });

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Carregando campanhas" className="space-y-3">
        <div className="h-8 animate-pulse rounded-lg bg-muted" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center text-sm text-destructive">
        <p>Não foi possível carregar as campanhas.</p>
        <Button variant="outline" size="sm" onClick={refresh} className="mt-3">
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { campaigns, refs, canWrite } = query.data;

  const handleCreateDraft = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCampaignName.trim();
    if (!name) return;

    const firstChannel = refs.channels[0]?.id;
    if (!firstChannel) {
      toast.error("É necessário ter ao menos um canal cadastrado antes de criar campanhas.");
      return;
    }

    startTransition(async () => {
      const res = await saveCampaignDraft({
        name,
        audience: {
          channelIds: [firstChannel],
          tagsAll: [],
          tagsAny: [],
          tagsNone: [],
          stageIds: [],
          minLeadScore: null,
          lastInteractionDays: null,
          entryLinkIds: [],
        },
        message: {
          text: "Olá! Temos uma novidade para você.",
        },
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      toast.success("Rascunho criado com sucesso.");
      setCreateOpen(false);
      setNewCampaignName("");
      refresh();
      router.push(`/automacoes/campanhas/${res.data.id}`);
    });
  };

  const handleDelete = () => {
    if (!deletingCampaign) return;
    startTransition(async () => {
      const res = await deleteCampaign(deletingCampaign.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Campanha excluída com sucesso.");
      setDeletingCampaign(null);
      refresh();
    });
  };

  const handleCancel = () => {
    if (!cancellingCampaign) return;
    startTransition(async () => {
      const res = await cancelCampaign(cancellingCampaign.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Campanha cancelada com sucesso.");
      setCancellingCampaign(null);
      refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Campanhas de transmissão</h2>
          <p className="text-sm text-muted-foreground">
            Envie mensagens pontuais em massa respeitando a janela de 24h e o ritmo de entrega.
          </p>
        </div>

        {canWrite && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <PlusIcon className="size-4" />
            Nova campanha
          </Button>
        )}
      </div>

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/50 p-12 text-center">
          <SendIcon className="mx-auto size-10 text-muted-foreground/60" />
          <h3 className="mt-3 text-base font-medium">Nenhuma campanha criada ainda</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Crie sua primeira campanha para se comunicar com sua base de contatos em massa.
          </p>
          {canWrite && (
            <Button onClick={() => setCreateOpen(true)} variant="outline" className="mt-4 gap-2">
              <PlusIcon className="size-4" />
              Criar primeira campanha
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-xs font-medium text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Agendamento / Envio</th>
                  <th className="px-4 py-3">Entregas</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {campaigns.map((c) => {
                  const statusConf = STATUS_CONFIG[c.status];
                  const Icon = statusConf.icon;

                  let scheduleText = "—";
                  if (c.scheduledAt) {
                    const d = new Date(c.scheduledAt);
                    scheduleText = d.toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    });
                  } else if (c.status === "draft") {
                    scheduleText = "Não agendado";
                  }

                  return (
                    <tr key={c.id} className="transition-colors hover:bg-muted/40">
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/automacoes/campanhas/${c.id}`}
                          className="hover:text-primary hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusConf.bg}`}
                        >
                          <Icon className="size-3" />
                          {CAMPAIGN_STATUS_LABEL[c.status] ?? c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{scheduleText}</td>
                      <td className="px-4 py-3">
                        {c.totalRecipients > 0 ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {c.sentCount} enviados
                            </span>
                            <span className="text-muted-foreground">
                              de {c.totalRecipients}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {c.status === "draft" ? (
                            <>
                              <Link
                                href={`/automacoes/campanhas/${c.id}`}
                                className={buttonVariants({ variant: "outline", size: "sm" })}
                              >
                                <PencilIcon className="size-3.5" />
                                Editar
                              </Link>
                              {canWrite && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeletingCampaign(c)}
                                  className="text-destructive hover:bg-destructive/10"
                                >
                                  <Trash2Icon className="size-3.5" />
                                </Button>
                              )}
                            </>
                          ) : (
                            <>
                              <Link
                                href={`/automacoes/campanhas/${c.id}`}
                                className={buttonVariants({ variant: "outline", size: "sm" })}
                              >
                                <BarChart3Icon className="size-3.5" />
                                Relatório
                              </Link>
                              {canWrite && (c.status === "scheduled" || c.status === "sending") && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setCancellingCampaign(c)}
                                  className="text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                                >
                                  <StopCircleIcon className="size-3.5" />
                                  Cancelar
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Criação de Rascunho */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreateDraft}>
            <DialogHeader>
              <DialogTitle>Nova campanha</DialogTitle>
              <DialogDescription>
                Dê um nome para identificar a campanha. Em seguida, você configurará o público e a
                mensagem no assistente.
              </DialogDescription>
            </DialogHeader>

            <div className="my-4 space-y-3">
              <Label htmlFor="campaign-name">Nome da campanha</Label>
              <Input
                id="campaign-name"
                value={newCampaignName}
                onChange={(e) => setNewCampaignName(e.target.value)}
                placeholder="Ex: Lançamento de Verão, Reengajamento Outubro"
                maxLength={100}
                required
                autoFocus
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || !newCampaignName.trim()}>
                {pending && <Loader2Icon className="size-4 animate-spin" />}
                Continuar para assistente
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de Exclusão de Rascunho */}
      <Dialog
        open={Boolean(deletingCampaign)}
        onOpenChange={(open) => !open && setDeletingCampaign(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir rascunho de campanha</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o rascunho da campanha &quot;
              {deletingCampaign?.name}&quot;? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingCampaign(null)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={pending}
            >
              {pending && <Loader2Icon className="size-4 animate-spin" />}
              Excluir rascunho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Cancelamento de Campanha */}
      <Dialog
        open={Boolean(cancellingCampaign)}
        onOpenChange={(open) => !open && setCancellingCampaign(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar campanha</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja cancelar a campanha &quot;
              {cancellingCampaign?.name}&quot;? As entregas pendentes não serão enviadas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancellingCampaign(null)}
              disabled={pending}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={pending}
            >
              {pending && <Loader2Icon className="size-4 animate-spin" />}
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
