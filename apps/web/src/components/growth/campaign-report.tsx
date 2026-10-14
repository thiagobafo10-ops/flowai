"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  BarChart2Icon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  MousePointerClickIcon,
  StopCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cancelCampaign } from "@/lib/growth/actions";
import { CAMPAIGN_STATUS_LABEL, DELIVERY_REASON_LABEL } from "@/lib/growth/messages";
import type { CampaignDetails, CampaignReportPayload } from "@/lib/growth/queries";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PAGE_SIZE = 50;

export function CampaignReport({
  campaign,
  initialReport,
  canWrite,
}: {
  campaign: CampaignDetails;
  initialReport: CampaignReportPayload;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [report, setReport] = useState<CampaignReportPayload>(initialReport);
  const [page, setPage] = useState(0);
  const [loadingPage, setLoadingPage] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, startCancel] = useTransition();

  const counts = report.counts;
  const sentCount = counts.sent ?? 0;
  const skippedCount = Object.values(counts.skipped ?? {}).reduce((a, b) => a + b, 0);
  const failedCount = Object.values(counts.failed ?? {}).reduce((a, b) => a + b, 0);
  const cancelledCount = counts.cancelled ?? 0;
  const totalDeliveries = sentCount + skippedCount + failedCount + cancelledCount;
  const deliveryRate = totalDeliveries > 0 ? Math.round((sentCount / totalDeliveries) * 100) : 0;

  const totalClicks = Object.values(report.clicks ?? {}).reduce((a, b) => a + b, 0);

  const isCancellable = campaign.status === "scheduled" || campaign.status === "sending";

  const handleCancel = () => {
    startCancel(async () => {
      const res = await cancelCampaign(campaign.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Campanha cancelada.");
      setCancelOpen(false);
      router.refresh();
    });
  };

  const loadPage = async (nextPage: number) => {
    setLoadingPage(true);
    try {
      const res = await fetch(
        `/api/campanhas/${campaign.id}?limit=${PAGE_SIZE}&offset=${nextPage * PAGE_SIZE}`,
      );
      if (res.ok) {
        const json = await res.json();
        if (json.report) {
          setReport(json.report);
          setPage(nextPage);
        }
      }
    } finally {
      setLoadingPage(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/automacoes/campanhas"
            aria-label="Voltar para campanhas"
            className={buttonVariants({ variant: "ghost", size: "icon" })}
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight">{campaign.name}</h2>
              <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium">
                {CAMPAIGN_STATUS_LABEL[campaign.status] ?? campaign.status}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {campaign.scheduledAt ? (
                <span>
                  Disparo em:{" "}
                  {new Date(campaign.scheduledAt).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              ) : (
                <span>Criada em {new Date(campaign.createdAt).toLocaleDateString("pt-BR")}</span>
              )}
              {campaign.finishedAt && (
                <span>
                  {" "}
                  · Finalizada em{" "}
                  {new Date(campaign.finishedAt).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              )}
            </p>
          </div>
        </div>

        {canWrite && isCancellable && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCancelOpen(true)}
            className="gap-1.5 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
          >
            <StopCircleIcon className="size-3.5" />
            Cancelar campanha
          </Button>
        )}
      </div>

      {/* Cards de Métricas Principais */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Enviados */}
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span>Enviados com sucesso</span>
              <CheckCircle2Icon className="size-4" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">{sentCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{deliveryRate}% de taxa de entrega</p>
          </CardContent>
        </Card>

        {/* Fora da janela */}
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between text-xs font-medium text-amber-600 dark:text-amber-400">
              <span>Fora da janela (24h)</span>
              <AlertCircleIcon className="size-4" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">
              {counts.skipped?.window_closed ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Ignorados por restrição da Meta</p>
          </CardContent>
        </Card>

        {/* Cliques / Engajamento */}
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between text-xs font-medium text-primary">
              <span>Cliques e Respostas</span>
              <MousePointerClickIcon className="size-4" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">{totalClicks}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Interações com botões da mensagem</p>
          </CardContent>
        </Card>

        {/* Falhas e Outros */}
        <Card className="border-muted bg-card">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>Outros motivos / Falhas</span>
              <XCircleIcon className="size-4" />
            </CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">
              {failedCount + (skippedCount - (counts.skipped?.window_closed ?? 0))}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Erros de envio ou formato</p>
          </CardContent>
        </Card>
      </div>

      {/* Desempenho de Cliques por Opção */}
      {Object.keys(report.clicks ?? {}).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart2Icon className="size-4 text-primary" />
              Interação por botão / resposta rápida
            </CardTitle>
            <CardDescription>
              Quantidade de contatos que clicaram em cada opção interativa da campanha.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(report.clicks).map(([optionId, count]) => {
                // Tenta achar o título do botão ou resposta rápida na mensagem da campanha
                const btn = campaign.message.buttons?.find((b) => b.id === optionId);
                const qr = campaign.message.quickReplies?.find((q) => q.id === optionId);
                const title = btn?.title ?? qr?.title ?? `Opção ${optionId}`;
                const pct = totalClicks > 0 ? Math.round((count / totalClicks) * 100) : 0;

                return (
                  <div key={optionId} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{title}</span>
                      <span className="text-muted-foreground">
                        {count} cliques ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabela de Destinatários */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Destinatários da campanha</CardTitle>
          <CardDescription>
            Histórico individual de cada contato alcançado ou ignorado no envio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {report.recipients.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum destinatário registrado para esta campanha.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b bg-muted/40 text-xs font-medium text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-2.5">Contato</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Motivo / Detalhes</th>
                      <th className="px-4 py-2.5 text-right">Horário</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {report.recipients.map((r) => {
                      let statusBadge = (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {r.status}
                        </span>
                      );

                      if (r.status === "sent") {
                        statusBadge = (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2Icon className="size-3" />
                            Enviado
                          </span>
                        );
                      } else if (r.status === "skipped") {
                        statusBadge = (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                            <AlertCircleIcon className="size-3" />
                            Ignorado
                          </span>
                        );
                      } else if (r.status === "failed") {
                        statusBadge = (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                            <XCircleIcon className="size-3" />
                            Falhou
                          </span>
                        );
                      } else if (r.status === "cancelled") {
                        statusBadge = (
                          <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs text-rose-600 dark:text-rose-400">
                            Cancelado
                          </span>
                        );
                      }

                      return (
                        <tr key={r.id} className="hover:bg-muted/30">
                          <td className="px-4 py-2.5 font-medium">
                            {r.contact_name || (
                              <span className="text-muted-foreground">Contato</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">{statusBadge}</td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {r.reason ? (DELIVERY_REASON_LABEL[r.reason] ?? r.reason) : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                            {new Date(r.created_at).toLocaleString("pt-BR", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs">
                <span className="text-muted-foreground">
                  Página {page + 1} (mostrando até {PAGE_SIZE} registros)
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadPage(page - 1)}
                    disabled={page === 0 || loadingPage}
                    className="h-7 px-2"
                  >
                    <ChevronLeftIcon className="size-3.5" />
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => loadPage(page + 1)}
                    disabled={report.recipients.length < PAGE_SIZE || loadingPage}
                    className="h-7 px-2"
                  >
                    Próxima
                    <ChevronRightIcon className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal de Cancelamento de Campanha */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar campanha em andamento</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja cancelar esta campanha? Todas as mensagens pendentes serão
              canceladas imediatamente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
              {cancelling && <Loader2Icon className="size-4 animate-spin" />}
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
