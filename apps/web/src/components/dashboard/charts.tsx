"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBRL, formatInteger, toChartData, type DashboardMetrics } from "@flowai/core";
import { Card } from "@/components/ui/card";

const TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
const INITIAL = { width: 400, height: 256 };

function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: ReactNode }) {
  return (
    <Card className="px-4">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="h-64 w-full">
        {empty ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sem dados no período
          </p>
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

export function DashboardCharts({ data }: { data: DashboardMetrics }) {
  const { conversations, aiVsHandoff, funnel } = toChartData(data);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard title="Conversas por dia" empty={conversations.every((p) => p.count === 0)}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
          <BarChart data={conversations}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--muted)" }} />
            <Bar dataKey="count" name="Conversas" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Funil do pipeline" empty={funnel.length === 0 || funnel.every((s) => s.count === 0)}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
          <BarChart data={funnel} layout="vertical">
            <CartesianGrid horizontal={false} stroke="var(--border)" />
            <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={96} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ fill: "var(--muted)" }}
              formatter={(v, _n, item) => [
                `${formatInteger(Number(v))} (${formatBRL(Number(item.payload?.value ?? 0))})`,
                "Quantidade",
              ]}
            />
            <Bar dataKey="count" name="Quantidade" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="IA × transferências" empty={aiVsHandoff.every((p) => p.ai === 0 && p.handoff === 0)}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
          <LineChart data={aiVsHandoff}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend />
            <Line type="monotone" dataKey="ai" name="IA" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
            <Line
              type="monotone"
              dataKey="handoff"
              name="Transferências"
              stroke="var(--chart-4)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
