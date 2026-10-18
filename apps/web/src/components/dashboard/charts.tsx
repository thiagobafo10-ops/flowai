"use client";

import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBRL, formatInteger, toChartData, type DashboardMetrics } from "@flowai/core";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IconOrb } from "@/components/ui/icon-orb";
import { cn } from "@/lib/utils";
import { FilterIcon, HeadphonesIcon, MessagesSquareIcon } from "lucide-react";

const TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "none",
  borderRadius: 14,
  padding: "8px 12px",
  boxShadow: "var(--elevation-float)",
  fontSize: 12,
} as const;
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 11 };
const INITIAL = { width: 400, height: 256 };
const BAR_RADIUS: [number, number, number, number] = [10, 10, 10, 10];

function ChartCard({
  title,
  icon,
  empty,
  className,
  children,
}: {
  title: string;
  icon: ReactNode;
  empty: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("col-span-12 gap-5", className)}>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <CardAction>
          <IconOrb size="sm" aria-hidden="true">
            {icon}
          </IconOrb>
        </CardAction>
      </CardHeader>
      <CardContent className="h-56">
        {empty ? (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sem dados no período
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/** Barras pretas com a maior do período em lima: o acento marca o pico, não a série. */
export function ConversationsChart({ data }: { data: DashboardMetrics }) {
  const { conversations } = toChartData(data);
  const empty = conversations.every((point) => point.count === 0);
  const peak = conversations.reduce(
    (best, point, index) => (point.count > conversations[best].count ? index : best),
    0,
  );
  return (
    <ChartCard
      className="xl:col-span-6"
      title="Conversas por dia"
      icon={<MessagesSquareIcon />}
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
        <BarChart data={conversations} barCategoryGap="30%">
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="count" name="Conversas" radius={BAR_RADIUS} maxBarSize={26}>
            {conversations.map((point, index) => (
              <Cell
                key={index}
                fill={index === peak ? "var(--chart-3)" : "var(--chart-1)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function FunnelChart({ data }: { data: DashboardMetrics }) {
  const { funnel } = toChartData(data);
  const empty = funnel.length === 0 || funnel.every((stage) => stage.count === 0);
  return (
    <ChartCard
      className="xl:col-span-5"
      title="Funil do pipeline"
      icon={<FilterIcon />}
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
        <BarChart data={funnel} layout="vertical" barCategoryGap="25%">
          <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={96}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: "var(--muted)" }}
            formatter={(v, _n, item) => [
              `${formatInteger(Number(v))} (${formatBRL(Number(item.payload?.value ?? 0))})`,
              "Quantidade",
            ]}
          />
          <Bar dataKey="count" name="Quantidade" fill="var(--chart-1)" radius={BAR_RADIUS} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function AiVsHandoffChart({ data }: { data: DashboardMetrics }) {
  const { aiVsHandoff } = toChartData(data);
  const empty = aiVsHandoff.every((point) => point.ai === 0 && point.handoff === 0);
  return (
    <ChartCard
      className="xl:col-span-4"
      title="IA × transferências"
      icon={<HeadphonesIcon />}
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
        <LineChart data={aiVsHandoff}>
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="ai"
            name="IA"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--chart-1)", strokeWidth: 0 }}
          />
          <Line
            type="monotone"
            dataKey="handoff"
            name="Transferências"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--chart-2)", strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
