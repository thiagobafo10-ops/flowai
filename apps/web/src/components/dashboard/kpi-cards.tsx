import { ActivityIcon, BotIcon, TrendingUpIcon } from "lucide-react";
import {
  formatBRL,
  formatInteger,
  formatPercent,
  periodLabel,
  type DashboardMetrics,
  type DashboardPeriod,
} from "@flowai/core";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconOrb } from "@/components/ui/icon-orb";
import { KpiProgress, KpiStat } from "./kpi-stat";

type Props = { data: DashboardMetrics; period: DashboardPeriod };

/** Cartão que abre o dia: o volume de conversas e quem chegou agora. */
export function PulseCard({ data, period }: Props) {
  const k = data.kpis;
  return (
    <Card className="col-span-12 gap-6 md:col-span-6 xl:col-span-3">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Pulso de hoje</CardTitle>
        <CardAction>
          <IconOrb size="sm" aria-hidden="true">
            <ActivityIcon />
          </IconOrb>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <KpiStat
          size="hero"
          title="Conversas hoje"
          value={formatInteger(k.conversations_today)}
          caption="desde 00h"
        />
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-muted p-3">
          <KpiStat
            title="Novos contatos"
            value={formatInteger(k.new_contacts)}
            caption={periodLabel(period)}
          />
          <KpiStat title="Leads" value={formatInteger(k.leads)} caption="agora" />
        </div>
      </CardContent>
    </Card>
  );
}

/** Dinheiro e conversão: onde o funil vira receita. */
export function PipelineCard({ data, period }: Props) {
  const k = data.kpis;
  return (
    <Card className="col-span-12 gap-6 md:col-span-6 xl:col-span-3">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Pipeline</CardTitle>
        <CardAction>
          <IconOrb size="sm" tone="dark" aria-hidden="true">
            <TrendingUpIcon />
          </IconOrb>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <KpiStat
          size="hero"
          title="Oportunidades"
          value={formatInteger(k.opportunities)}
          caption="agora"
        />
        <KpiStat
          title="Valor potencial"
          value={formatBRL(k.potential_value)}
          caption="agora"
        />
        <KpiProgress
          title="Conversão"
          value={formatPercent(k.conversion_rate)}
          ratio={k.conversion_rate}
          caption={periodLabel(period)}
        />
      </CardContent>
    </Card>
  );
}

/** Como o atendimento se resolve: IA, gente e o que ficou pelo caminho. */
export function ServiceCard({ data, period }: Props) {
  const k = data.kpis;
  return (
    <Card className="col-span-12 gap-6 md:col-span-6 xl:col-span-3">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Atendimento</CardTitle>
        <CardAction>
          <IconOrb size="sm" tone="muted" aria-hidden="true">
            <BotIcon />
          </IconOrb>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <KpiProgress
          title="Taxa de resolução"
          value={formatPercent(k.resolution_rate)}
          ratio={k.resolution_rate}
          caption={periodLabel(period)}
        />
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-muted p-3">
          <KpiStat
            title="Atendidas por IA"
            value={formatInteger(k.ai_handled_conversations)}
            caption={periodLabel(period)}
          />
          <KpiStat
            title="Transferências para humanos"
            value={formatInteger(k.handoffs)}
            caption={periodLabel(period)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
