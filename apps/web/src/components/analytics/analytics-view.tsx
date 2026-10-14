"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { DownloadIcon, FilterIcon, RefreshCwIcon } from "lucide-react";
import {
  analyticsMetricsSchema,
  formatAnalyticsCsv,
  parseAnalyticsPeriod,
  type AnalyticsMetrics,
  type AnalyticsPeriod,
} from "@flowai/core";
import { Button } from "@/components/ui/button";
import { KpiSummary } from "./kpi-summary";
import { ConversationsTab } from "./conversations-tab";
import { AiTab } from "./ai-tab";
import { CrmTab } from "./crm-tab";
import { AnalyticsSkeleton } from "./analytics-skeleton";
import { cn } from "@/lib/utils";

const ERROR_MESSAGE = "Não foi possível carregar as métricas de analytics.";

async function fetchAnalytics(period: AnalyticsPeriod, channelId?: string): Promise<AnalyticsMetrics> {
  const url = channelId
    ? `/api/analytics?periodo=${period}&canal=${encodeURIComponent(channelId)}`
    : `/api/analytics?periodo=${period}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(ERROR_MESSAGE);
  return analyticsMetricsSchema.parse(await res.json());
}

type TabType = "conversations" | "ai" | "crm";

type Props = {
  orgId: string;
  initialPeriod: AnalyticsPeriod;
  initialData: AnalyticsMetrics;
  channels: Array<{ id: string; name: string; type: string }>;
};

export function AnalyticsView({ orgId, initialPeriod, initialData, channels }: Props) {
  const searchParams = useSearchParams();
  const period = parseAnalyticsPeriod(searchParams.get("periodo"));
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabType>("conversations");

  const { data, isError, isFetching, refetch } = useQuery({
    queryKey: ["analytics", orgId, period, selectedChannel],
    queryFn: () => fetchAnalytics(period, selectedChannel || undefined),
    initialData: period === initialPeriod && !selectedChannel ? initialData : undefined,
    staleTime: 30_000,
    refetchOnMount: "always",
    retry: false,
  });

  function changePeriod(next: AnalyticsPeriod) {
    const params = new URLSearchParams(window.location.search);
    params.set("periodo", next);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }

  function handleExportCsv() {
    if (!data) return;
    const csvContent = formatAnalyticsCsv(data);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `analytics-${period}-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const periodOptions: Array<{ key: AnalyticsPeriod; label: string }> = [
    { key: "1d", label: "Hoje" },
    { key: "7d", label: "7 dias" },
    { key: "30d", label: "30 dias" },
    { key: "90d", label: "90 dias" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-1 rounded-xl border bg-muted/40 p-1">
          {periodOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => changePeriod(opt.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                period === opt.key
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {channels.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2.5 py-1 text-xs">
              <FilterIcon className="size-3.5 text-muted-foreground" />
              <select
                aria-label="Filtrar por canal"
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="bg-transparent text-xs font-medium outline-none"
              >
                <option value="">Todos os canais</option>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name} ({ch.type})
                  </option>
                ))}
              </select>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={!data || isFetching}
            className="gap-1.5 text-xs"
          >
            <DownloadIcon className="size-3.5" />
            <span>Exportar CSV</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Atualizar dados"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCwIcon className={cn("size-3.5", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {data ? (
        <>
          {!data.has_activity && (
            <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 text-xs text-muted-foreground">
              <span className="font-semibold text-primary">Nenhuma atividade registrada no período:</span> Os
              gráficos e indicadores exibirão contagens quando houver novas mensagens, atendimentos de IA ou negócios
              gerados.
            </div>
          )}

          <KpiSummary summary={data.summary} />

          <div className="space-y-4">
            <div role="tablist" aria-label="Seções do Analytics" className="flex border-b">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "conversations"}
                onClick={() => setActiveTab("conversations")}
                className={cn(
                  "border-b-2 px-4 py-2 text-xs font-medium transition-all",
                  activeTab === "conversations"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Atendimento & Conversas
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "ai"}
                onClick={() => setActiveTab("ai")}
                className={cn(
                  "border-b-2 px-4 py-2 text-xs font-medium transition-all",
                  activeTab === "ai"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Inteligência Artificial
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "crm"}
                onClick={() => setActiveTab("crm")}
                className={cn(
                  "border-b-2 px-4 py-2 text-xs font-medium transition-all",
                  activeTab === "crm"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Vendas & Funil do CRM
              </button>
            </div>

            {activeTab === "conversations" && <ConversationsTab data={data.conversations_section} />}
            {activeTab === "ai" && <AiTab data={data.ai_section} />}
            {activeTab === "crm" && <CrmTab data={data.crm_section} />}
          </div>
        </>
      ) : isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border p-6">
          <p role="alert" className="text-sm font-medium text-destructive">
            {ERROR_MESSAGE}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : (
        <AnalyticsSkeleton />
      )}
    </div>
  );
}
