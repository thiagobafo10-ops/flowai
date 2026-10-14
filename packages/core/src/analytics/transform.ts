import {
  analyticsPeriodSchema,
  type AnalyticsMetrics,
  type AnalyticsPeriod,
} from "./schemas.ts";

/**
 * Calcula a variação percentual (delta %) entre o período atual e o anterior.
 * Retorna null se não houver base de comparação (ambos zero).
 */
export function calculateTrendPercentage(current: number, previous: number): number | null {
  if (previous === 0) {
    if (current === 0) return null;
    return 100;
  }
  const delta = ((current - previous) / previous) * 100;
  return Math.round(delta * 10) / 10;
}

/**
 * Converte string de query param para período suportado, com fallback padrão de 30 dias.
 */
export function parseAnalyticsPeriod(raw: unknown): AnalyticsPeriod {
  const parsed = analyticsPeriodSchema.safeParse(raw);
  return parsed.success ? parsed.data : "30d";
}

/**
 * Converte período em quantidade de dias.
 */
export function analyticsPeriodToDays(period: AnalyticsPeriod): number {
  switch (period) {
    case "1d":
      return 1;
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
  }
}

/**
 * Retorna o rótulo textual legível para o período.
 */
export function analyticsPeriodToLabel(period: AnalyticsPeriod): string {
  switch (period) {
    case "1d":
      return "Hoje";
    case "7d":
      return "Últimos 7 dias";
    case "30d":
      return "Últimos 30 dias";
    case "90d":
      return "Últimos 90 dias";
  }
}

/**
 * Formata as métricas analíticas consolidadas em CSV (UTF-8 com BOM).
 */
export function formatAnalyticsCsv(metrics: AnalyticsMetrics): string {
  const rows: string[][] = [
    ["Relatório de Analytics - FlowAI"],
    ["Período", metrics.period_label],
    [""],
    ["Resumo de Desempenho"],
    ["Métrica", "Valor", "Tendência vs Período Anterior"],
    [
      "Total de Conversas",
      String(metrics.summary.total_conversations),
      metrics.summary.conversations_trend != null ? `${metrics.summary.conversations_trend}%` : "-",
    ],
    [
      "Taxa de Resolução",
      metrics.summary.resolution_rate != null ? `${metrics.summary.resolution_rate}%` : "-",
      metrics.summary.resolution_trend != null ? `${metrics.summary.resolution_trend}%` : "-",
    ],
    [
      "Novos Contatos",
      String(metrics.summary.new_contacts),
      metrics.summary.contacts_trend != null ? `${metrics.summary.contacts_trend}%` : "-",
    ],
    ["Leads Qualificados", String(metrics.summary.new_leads), "-"],
    ["Taxa de Contenção IA", metrics.summary.ai_containment_rate != null ? `${metrics.summary.ai_containment_rate}%` : "-", "-"],
    ["Total em Pipeline", `R$ ${metrics.summary.total_pipeline_value}`, "-"],
    ["Valor Ganho em Vendas", `R$ ${metrics.summary.won_deals_value}`, "-"],
    ["Taxa de Conversão", metrics.summary.conversion_rate != null ? `${metrics.summary.conversion_rate}%` : "-", "-"],
    ["Ticket Médio", `R$ ${metrics.crm_section.avg_ticket}`, "-"],
    [""],
    ["Volume Diário de Conversas"],
    ["Data", "Recebidas", "Resolvidas"],
    ...metrics.conversations_section.daily_volume.map((d) => [d.day, String(d.received), String(d.resolved)]),
    [""],
    ["Atendimento por Canal"],
    ["Canal", "Tipo", "Conversas"],
    ...metrics.conversations_section.by_channel.map((c) => [c.channel_name, c.channel_type, String(c.count)]),
    [""],
    ["Funil de Vendas"],
    ["Etapa", "Posição", "Oportunidades", "Valor (R$)"],
    ...metrics.crm_section.funnel.map((f) => [f.stage_name, String(f.position), String(f.count), String(f.value)]),
  ];

  const csvContent = rows
    .map((row) =>
      row
        .map((cell) => {
          const escaped = String(cell).replace(/"/g, '""');
          return escaped.includes(",") || escaped.includes("\n") || escaped.includes('"')
            ? `"${escaped}"`
            : escaped;
        })
        .join(","),
    )
    .join("\r\n");

  return `\uFEFF${csvContent}`;
}
