"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBRL, formatInteger, type AnalyticsCrmSection } from "@flowai/core";
import { Card } from "@/components/ui/card";
import { DollarSignIcon, TrendingUpIcon } from "lucide-react";

const TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
const INITIAL = { width: 400, height: 260 };

function formatDayLabel(day: string): string {
  const parts = day.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : day;
}

export function CrmTab({ data }: { data: AnalyticsCrmSection }) {
  const chartDeals = data.daily_deals.map((d) => ({
    ...d,
    label: formatDayLabel(d.day),
  }));

  const funnelData = data.funnel.map((s) => ({
    ...s,
    name: s.stage_name,
  }));

  const totalDealsInFunnel = data.funnel.reduce((acc, curr) => acc + curr.count, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="flex items-center gap-4 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <DollarSignIcon className="size-5" />
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Ticket Médio das Vendas Ganhas</span>
            <p className="text-xl font-bold tabular-nums">{formatBRL(data.avg_ticket)}</p>
          </div>
        </Card>

        <Card className="flex items-center gap-4 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <TrendingUpIcon className="size-5" />
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Oportunidades no Funil Atual</span>
            <p className="text-xl font-bold tabular-nums">{formatInteger(totalDealsInFunnel)} negócios</p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Funil de Vendas por Etapa</h3>
            <p className="text-xs text-muted-foreground">Volume de negócios abertos e valor financeiro acumulado</p>
          </div>
          <div className="h-72 w-full">
            {funnelData.length === 0 || funnelData.every((s) => s.count === 0) ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Nenhum negócio em aberto no funil
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
                <BarChart data={funnelData} layout="vertical">
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={90} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v, _n, item) => [
                      `${formatInteger(Number(v))} (${formatBRL(Number(item.payload?.value ?? 0))})`,
                      "Negócios",
                    ]}
                  />
                  <Bar dataKey="count" name="Negócios" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Criação vs Fechamento de Vendas</h3>
            <p className="text-xs text-muted-foreground">Novos negócios gerados versus negócios ganhos a cada dia</p>
          </div>
          <div className="h-72 w-full">
            {chartDeals.length === 0 || chartDeals.every((d) => d.created === 0 && d.won === 0) ? (
              <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Sem atividade de vendas no período selecionado
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
                <BarChart data={chartDeals}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend />
                  <Bar
                    dataKey="created"
                    name="Criados"
                    fill="var(--chart-1)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="won"
                    name="Ganhos"
                    fill="var(--chart-3)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
