"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClockIcon,
  Loader2Icon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { deleteSequence, saveSequence, setSequenceStatus } from "@/lib/growth/actions";
import type { GrowthChannel, SequenceListItem } from "@/lib/growth/queries";
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

type ApiData = { sequences: SequenceListItem[]; channels: GrowthChannel[]; canWrite: boolean };

async function fetchSequences(): Promise<ApiData> {
  const res = await fetch("/api/sequencias", { cache: "no-store" });
  if (!res.ok) throw new Error("Não foi possível carregar as sequências.");
  return res.json() as Promise<ApiData>;
}

export function SequencesView({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const query = useQuery({ queryKey: ["sequences", orgId], queryFn: fetchSequences });

  const [createOpen, setCreateOpen] = useState(false);
  const [newSeqName, setNewSeqName] = useState("");
  const [deletingSeq, setDeletingSeq] = useState<SequenceListItem | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["sequences", orgId] });

  if (query.isPending) {
    return (
      <div aria-busy="true" aria-label="Carregando sequências" className="space-y-3">
        <div className="h-8 animate-pulse rounded-lg bg-muted" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border p-6">
        <p className="text-sm text-destructive">Não foi possível carregar as sequências.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  const { sequences, channels, canWrite } = query.data;

  async function handleToggleStatus(seq: SequenceListItem) {
    const nextStatus = seq.status === "active" ? "paused" : "active";
    startTransition(async () => {
      const res = await setSequenceStatus({ id: seq.id, status: nextStatus });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(nextStatus === "active" ? "Sequência ativada." : "Sequência pausada.");
      refresh();
    });
  }

  async function handleDelete(seq: SequenceListItem) {
    startTransition(async () => {
      const res = await deleteSequence(seq.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Sequência excluída.");
      setDeletingSeq(null);
      refresh();
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newSeqName.trim() || channels.length === 0) return;

    startTransition(async () => {
      const res = await saveSequence({
        name: newSeqName.trim(),
        settings: {
          channelIds: [channels[0].id],
          exitOnReply: false,
          exitWords: ["sair", "parar", "cancelar"],
        },
        steps: [],
      });

      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      toast.success("Sequência criada. Configure os passos e mensagens.");
      setCreateOpen(false);
      setNewSeqName("");
      router.push(`/automacoes/sequencias/${res.data.id}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h2 className="text-lg font-medium">Sequências programadas</h2>
          <p className="text-sm text-muted-foreground">
            Séries de mensagens automáticas com esperas programadas e janelas de horário no fuso da empresa.
          </p>
        </div>
        {canWrite && (
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <PlusIcon className="size-4" />
            Nova sequência
          </Button>
        )}
      </div>

      {sequences.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
          <ClockIcon className="size-10 text-muted-foreground/60 mb-2" />
          <p className="text-sm font-medium">Nenhuma sequência criada.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Crie fluxos de mensagens de acompanhamento (nurturing) para novos leads e clientes.
          </p>
          {canWrite && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4 gap-1.5"
              onClick={() => setCreateOpen(true)}
            >
              <PlusIcon className="size-4" />
              Criar primeira sequência
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Passos</th>
                <th className="px-4 py-3 font-medium">Inscritos ativos</th>
                <th className="px-4 py-3 font-medium">Envios (7d)</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sequences.map((seq) => (
                <tr key={seq.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <Link
                      href={`/automacoes/sequencias/${seq.id}`}
                      className="font-medium text-foreground hover:underline"
                    >
                      {seq.name}
                    </Link>
                  </td>

                  <td className="px-4 py-3 text-xs">
                    <span className="font-semibold">{seq.stepsCount}</span> {seq.stepsCount === 1 ? "passo" : "passos"}
                  </td>

                  <td className="px-4 py-3 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <UsersIcon className="size-3.5 text-foreground" />
                      <span className="font-semibold text-foreground">{seq.activeEnrollments}</span> ativos
                    </div>
                  </td>

                  <td className="px-4 py-3 text-xs font-medium">
                    {seq.sent7d} envios
                  </td>

                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
                        seq.status === "active"
                          ? "bg-secondary text-secondary-foreground"
                          : seq.status === "paused"
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                            : "text-muted-foreground"
                      }`}
                    >
                      {seq.status === "active" ? "Ativa" : seq.status === "paused" ? "Pausada" : "Rascunho"}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        href={`/automacoes/sequencias/${seq.id}`}
                        className="inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-muted"
                      >
                        <PencilIcon className="size-3.5" />
                        <span>Editar</span>
                      </Link>

                      {canWrite && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={pending || (seq.status === "draft" && seq.stepsCount === 0)}
                            onClick={() => handleToggleStatus(seq)}
                            className="gap-1"
                            title={seq.status === "active" ? "Pausar sequência" : "Ativar sequência"}
                          >
                            {seq.status === "active" ? (
                              <>
                                <PauseIcon className="size-3.5 text-amber-600" />
                                <span>Pausar</span>
                              </>
                            ) : (
                              <>
                                <PlayIcon className="size-3.5 text-emerald-600" />
                                <span>Ativar</span>
                              </>
                            )}
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={pending}
                            onClick={() => setDeletingSeq(seq)}
                            className="gap-1 text-destructive hover:text-destructive"
                            title="Excluir sequência"
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Criar Nova Sequência */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova sequência</DialogTitle>
            <DialogDescription>
              Dê um nome para a sequência. Em seguida, você poderá configurar os passos e mensagens.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="seq-name">Nome da sequência</Label>
              <Input
                id="seq-name"
                placeholder="Ex: Boas-vindas novos clientes, Recuperação de leads"
                value={newSeqName}
                onChange={(e) => setNewSeqName(e.target.value)}
                required
                disabled={pending}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending || !newSeqName.trim()}>
                {pending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
                Continuar para o editor
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <Dialog open={Boolean(deletingSeq)} onOpenChange={(v) => !v && setDeletingSeq(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir sequência?</DialogTitle>
            <DialogDescription>
              A sequência &quot;{deletingSeq?.name}&quot; e suas mensagens agendadas pendentes serão canceladas permanentemente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setDeletingSeq(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => deletingSeq && handleDelete(deletingSeq)}
            >
              {pending && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
