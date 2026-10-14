import { describe, expect, it } from "vitest";
import { calculateTrendPercentage, formatAnalyticsCsv, periodToDays, parseAnalyticsPeriod } from "./transform.js";
import type { AnalyticsMetrics } from "./schemas.js";

describe("calculateTrendPercentage", () => {
  it("calcula delta positivo corretamente", () => {
    expect(calculateTrendPercentage(120, 100)).toBe(20);
  });

  it("calcula delta negativo corretamente", () => {
    expect(calculateTrendPercentage(80, 100)).toBe(-20);
  });

  it("retorna 0 quando os dois valores são iguais", () => {
    expect(calculateTrendPercentage(50, 50)).toBe(0);
  });

  it("retorna null quando o valor anterior é zero e o atual é zero", () => {
    expect(calculateTrendPercentage(0, 0)).toBeNull();
  });

  it("retorna 100 quando o valor anterior é zero e o atual é positivo", () => {
    expect(calculateTrendPercentage(10, 0)).toBe(100);
  });
});

describe("parseAnalyticsPeriod & periodToDays", () => {
  it("converte string em período com fallback seguro", () => {
    expect(parseAnalyticsPeriod("7d")).toBe("7d");
    expect(parseAnalyticsPeriod("30d")).toBe("30d");
    expect(parseAnalyticsPeriod("90d")).toBe("90d");
    expect(parseAnalyticsPeriod("1d")).toBe("1d");
    expect(parseAnalyticsPeriod("invalid")).toBe("30d");
    expect(parseAnalyticsPeriod(null)).toBe("30d");
  });

  it("converte período para número de dias", () => {
    expect(periodToDays("1d")).toBe(1);
    expect(periodToDays("7d")).toBe(7);
    expect(periodToDays("30d")).toBe(30);
    expect(periodToDays("90d")).toBe(90);
  });
});

describe("formatAnalyticsCsv", () => {
  const sampleMetrics: AnalyticsMetrics = {
    period_days: 7,
    period_label: "Últimos 7 dias",
    has_activity: true,
    summary: {
      total_conversations: 50,
      conversations_trend: 10,
      resolution_rate: 80,
      resolution_trend: 5,
      new_contacts: 20,
      contacts_trend: 0,
      new_leads: 12,
      total_pipeline_value: 30000,
      won_deals_value: 12000,
      conversion_rate: 25,
      ai_containment_rate: 60,
    },
    conversations_section: {
      daily_volume: [{ day: "2026-10-10", received: 10, resolved: 8 }],
      by_channel: [{ channel_id: "c1", channel_name: "Insta", channel_type: "instagram", count: 50 }],
      by_status: [{ status: "closed", count: 40 }, { status: "open", count: 10 }],
    },
    ai_section: {
      daily_ai_vs_human: [{ day: "2026-10-10", ai_replied: 8, handoffs: 2 }],
      total_ai_messages: 100,
      total_handoffs: 15,
      top_handoff_reasons: [{ reason: "Humano", count: 10 }],
    },
    crm_section: {
      funnel: [{ stage_id: "s1", stage_name: "Novo", position: 1, count: 10, value: 20000 }],
      daily_deals: [{ day: "2026-10-10", created: 2, won: 1 }],
      avg_ticket: 2000,
    },
  };

  it("gera string CSV com cabeçalhos e formatação UTF-8", () => {
    const csv = formatAnalyticsCsv(sampleMetrics);
    expect(csv).toContain("Métrica,Valor");
    expect(csv).toContain("Total de Conversas,50");
    expect(csv).toContain("Taxa de Resolução,80%");
    expect(csv).toContain("Valor Ganho em Vendas,R$ 12000");
  });
});
