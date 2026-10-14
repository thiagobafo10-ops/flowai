"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatInteger, type AnalyticsConversationsSection } from "@flowai/core";
import { Card } from "@/components/ui/card";

const TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};
const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };
const INITIAL = { width: 400, height: 260 };

const STATUS_LABELS: Record<string, string> = {
  open: "Abertas",
  waiting: "Aguardando",
  closed: "Fechadas",
};

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatDayLabel(day: string): string {
  const parts = day.split("-");
  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : day;
}

export function ConversationsTab({ data }: { data: AnalyticsConversationsSection }) {
  const chartDaily = data.daily_volume.map((d) => ({
    ...d,
    label: formatDayLabel(d.day),
  }));

  const channelData = data.by_channel.filter((c) => c.count > 0);
  const statusData = data.by_status.filter((s) => s.count > 0);

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold">Volume Diário de Atendimento</h3>
          <p className="text-xs text-muted-foreground">Conversas recebidas versus conversas resolvidas a cada dia</p>
        </div>
        <div className="h-72 w-full">
          {chartDaily.length === 0 || chartDaily.every((d) => d.received === 0 && d.resolved === 0) ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Sem dados de conversas no período selecionado
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
              <AreaChart data={chartDaily}>
                <defs>
                  <linearGradient id="gradReceived" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="received"
                  name="Recebidas"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gradReceived)"
                />
                <Area
                  type="monotone"
                  dataKey="resolved"
                  name="Resolvidas"
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gradResolved)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Atendimento por Canal</h3>
            <p className="text-xs text-muted-foreground">Concentração de conversas por canal conectado</p>
          </div>
          {channelData.length === 0 ? (
            <p className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Nenhuma conversa registrada por canal
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={channelData}
                      dataKey="count"
                      nameKey="channel_name"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                    >
                      {channelData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="divide-y text-xs">
                {channelData.map((c, i) => (
                  <li key={c.channel_id} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="font-medium">{c.channel_name}</span>
                      <span className="text-muted-foreground">({c.channel_type})</span>
                    </div>
                    <span className="font-semibold tabular-nums">{formatInteger(c.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Estado Atual das Conversas</h3>
            <p className="text-xs text-muted-foreground">Divisão entre abertas, aguardando e finalizadas</p>
          </div>
          {statusData.length === 0 ? (
            <p className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              Nenhuma conversa ativa no momento
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="count"
                      nameKey="status"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                    >
                      {statusData.map((s) => (
                        <Cell
                          key={`status-${s.status}`}
                          fill={
                            s.status === "closed"
                              ? "var(--chart-2)"
                              : s.status === "open"
                              ? "var(--chart-1)"
                              : "var(--chart-4)"
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v, name) => [formatInteger(Number(v)), STATUS_LABELS[String(name)] ?? name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {data.by_status.map((st) => (
                  <div key={st.status} className="rounded-lg border bg-muted/20 p-2.5">
                    <span className="text-xs text-muted-foreground">{STATUS_LABELS[st.status] ?? st.status}</span>
                    <p className="mt-0.5 text-lg font-bold tabular-nums">{formatInteger(st.count)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
