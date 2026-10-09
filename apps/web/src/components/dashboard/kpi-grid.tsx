import {
  formatBRL,
  formatInteger,
  formatPercent,
  periodLabel,
  type DashboardMetrics,
  type DashboardPeriod,
} from "@flowai/core";
import { KpiCard } from "./kpi-card";

export function KpiGrid({ data, period }: { data: DashboardMetrics; period: DashboardPeriod }) {
  const k = data.kpis;
  const p = periodLabel(period);
  const cards = [
    { title: "Conversas hoje", value: formatInteger(k.conversations_today), caption: "desde 00h" },
    { title: "Novos contatos", value: formatInteger(k.new_contacts), caption: p },
    { title: "Leads", value: formatInteger(k.leads), caption: "agora" },
    { title: "Oportunidades", value: formatInteger(k.opportunities), caption: "agora" },
    { title: "Valor potencial", value: formatBRL(k.potential_value), caption: "agora" },
    { title: "Atendidas por IA", value: formatInteger(k.ai_handled_conversations), caption: p },
    { title: "Transferências para humanos", value: formatInteger(k.handoffs), caption: p },
    { title: "Taxa de resolução", value: formatPercent(k.resolution_rate), caption: p },
    { title: "Conversão", value: formatPercent(k.conversion_rate), caption: p },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <KpiCard key={c.title} {...c} />
      ))}
    </div>
  );
}
