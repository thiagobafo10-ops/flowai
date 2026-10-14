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
import { formatInteger, type AnalyticsAiSection } from "@flowai/core";
import { Card } from "@/components/ui/card";
import { BotIcon, HelpCircleIcon, UsersIcon } from "lucide-react";

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

export function AiTab({ data }: { data: AnalyticsAiSection }) {
  const chartDaily = data.daily_ai_vs_human.map((d) => ({
    ...d,
    label: formatDayLabel(d.day),
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="flex items-center gap-4 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <BotIcon className="size-5" />
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Mensagens geradas pela IA</span>
            <p className="text-xl font-bold tabular-nums">{formatInteger(data.total_ai_messages)}</p>
          </div>
        </Card>

        <Card className="flex items-center gap-4 p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <UsersIcon className="size-5" />
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Transferências para humanos (Handoffs)</span>
            <p className="text-xl font-bold tabular-nums">{formatInteger(data.total_handoffs)}</p>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold">Respostas da IA vs Intervenções Humanas</h3>
          <p className="text-xs text-muted-foreground">Acompanhamento diário de resolução automática versus escalonamento</p>
        </div>
        <div className="h-72 w-full">
          {chartDaily.length === 0 || chartDaily.every((d) => d.ai_replied === 0 && d.handoffs === 0) ? (
            <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Sem dados de atendimento de IA no período selecionado
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%" initialDimension={INITIAL}>
              <BarChart data={chartDaily}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend />
                <Bar
                  dataKey="ai_replied"
                  name="Respostas IA"
                  fill="var(--chart-1)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="handoffs"
                  name="Transferências"
                  fill="var(--chart-4)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <HelpCircleIcon className="size-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold">Principais Motivos de Transferência</h3>
            <p className="text-xs text-muted-foreground">Gatilhos mais frequentes que levaram à transferência para atendentes humanos</p>
          </div>
        </div>
        {data.top_handoff_reasons.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma transferência registrada no período. A IA conseguiu conduzir todas as interações!
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 font-medium text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2">Motivo / Intenção</th>
                  <th scope="col" className="px-3 py-2 text-right">Ocorrências</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.top_handoff_reasons.map((item, idx) => (
                  <tr key={idx} className="hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-medium">{item.reason}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                      {formatInteger(item.count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
