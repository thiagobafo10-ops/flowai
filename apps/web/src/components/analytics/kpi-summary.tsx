import { ArrowDownRightIcon, ArrowUpRightIcon, BotIcon, DollarSignIcon, MessageSquareIcon, SparklesIcon } from "lucide-react";
import { formatBRL, formatInteger, type AnalyticsSummary } from "@flowai/core";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function TrendBadge({ trend }: { trend: number | null }) {
  if (trend == null) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  const isPositive = trend > 0;
  const isNeutral = trend === 0;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
        isPositive && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        trend < 0 && "bg-rose-500/10 text-rose-600 dark:text-rose-400",
        isNeutral && "bg-muted text-muted-foreground",
      )}
    >
      {isPositive && <ArrowUpRightIcon className="size-3" />}
      {trend < 0 && <ArrowDownRightIcon className="size-3" />}
      <span>{trend > 0 ? `+${trend}%` : `${trend}%`}</span>
    </span>
  );
}

export function KpiSummary({ summary }: { summary: AnalyticsSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="flex flex-col justify-between p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Total de Conversas</span>
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <MessageSquareIcon className="size-3.5" />
          </div>
        </div>
        <div className="mt-2">
          <p className="text-2xl font-bold tracking-tight">{formatInteger(summary.total_conversations)}</p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendBadge trend={summary.conversations_trend} />
            <span>vs período anterior</span>
          </div>
        </div>
      </Card>

      <Card className="flex flex-col justify-between p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Taxa de Resolução</span>
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SparklesIcon className="size-3.5" />
          </div>
        </div>
        <div className="mt-2">
          <p className="text-2xl font-bold tracking-tight">
            {summary.resolution_rate != null ? `${summary.resolution_rate}%` : "-"}
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendBadge trend={summary.resolution_trend} />
            <span>resolvidas no período</span>
          </div>
        </div>
      </Card>

      <Card className="flex flex-col justify-between p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Contenção da IA</span>
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BotIcon className="size-3.5" />
          </div>
        </div>
        <div className="mt-2">
          <p className="text-2xl font-bold tracking-tight">
            {summary.ai_containment_rate != null ? `${summary.ai_containment_rate}%` : "-"}
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>sem intervenção humana</span>
          </div>
        </div>
      </Card>

      <Card className="flex flex-col justify-between p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Vendas Ganhas</span>
          <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <DollarSignIcon className="size-3.5" />
          </div>
        </div>
        <div className="mt-2">
          <p className="text-2xl font-bold tracking-tight">{formatBRL(summary.won_deals_value)}</p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {summary.conversion_rate != null ? `${summary.conversion_rate}%` : "0%"}
            </span>
            <span>conversão do funil</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
