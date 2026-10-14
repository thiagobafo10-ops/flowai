import { describe, expect, it } from "vitest";
import { analyticsMetricsSchema, analyticsPeriodSchema } from "./schemas.ts";

describe("analyticsPeriodSchema", () => {
  it("valida períodos suportados (1d, 7d, 30d, 90d)", () => {
    expect(analyticsPeriodSchema.parse("1d")).toBe("1d");
    expect(analyticsPeriodSchema.parse("7d")).toBe("7d");
    expect(analyticsPeriodSchema.parse("30d")).toBe("30d");
    expect(analyticsPeriodSchema.parse("90d")).toBe("90d");
  });

  it("rejeita períodos desconhecidos", () => {
    expect(() => analyticsPeriodSchema.parse("14d")).toThrow();
    expect(() => analyticsPeriodSchema.parse("")).toThrow();
  });
});

describe("analyticsMetricsSchema", () => {
  const validPayload = {
    period_days: 30,
    period_label: "Últimos 30 dias",
    has_activity: true,
    summary: {
      total_conversations: 120,
      conversations_trend: 15.5,
      resolution_rate: 85.0,
      resolution_trend: 4.2,
      new_contacts: 45,
      contacts_trend: -2.1,
      new_leads: 28,
      total_pipeline_value: 150000,
      won_deals_value: 45000,
      conversion_rate: 32.5,
      ai_containment_rate: 68.0,
    },
    conversations_section: {
      daily_volume: [
        { day: "2026-10-01", received: 10, resolved: 8 },
        { day: "2026-10-02", received: 15, resolved: 12 },
      ],
      by_channel: [
        {
          channel_id: "00000000-0000-0000-0000-000000000001",
          channel_name: "Instagram Principal",
          channel_type: "instagram",
          count: 100,
        },
      ],
      by_status: [
        { status: "open", count: 12 },
        { status: "waiting", count: 8 },
        { status: "closed", count: 100 },
      ],
    },
    ai_section: {
      daily_ai_vs_human: [
        { day: "2026-10-01", ai_replied: 8, handoffs: 2 },
      ],
      total_ai_messages: 250,
      total_handoffs: 35,
      top_handoff_reasons: [
        { reason: "Solicitação de atendente humano", count: 20 },
      ],
    },
    crm_section: {
      funnel: [
        { stage_id: "s1", stage_name: "Novo", position: 1, count: 25, value: 50000 },
        { stage_id: "s2", stage_name: "Qualificado", position: 2, count: 15, value: 35000 },
      ],
      daily_deals: [
        { day: "2026-10-01", created: 2, won: 1 },
      ],
      avg_ticket: 2500,
    },
  };

  it("valida um payload completo de métricas analíticas", () => {
    const parsed = analyticsMetricsSchema.parse(validPayload);
    expect(parsed.period_days).toBe(30);
    expect(parsed.summary.total_conversations).toBe(120);
    expect(parsed.crm_section.funnel).toHaveLength(2);
  });

  it("permite valores nulos para taxas e deltas quando não há histórico", () => {
    const payloadWithNulls = {
      ...validPayload,
      summary: {
        ...validPayload.summary,
        conversations_trend: null,
        resolution_rate: null,
        resolution_trend: null,
        contacts_trend: null,
        conversion_rate: null,
        ai_containment_rate: null,
      },
    };
    const parsed = analyticsMetricsSchema.parse(payloadWithNulls);
    expect(parsed.summary.conversations_trend).toBeNull();
    expect(parsed.summary.resolution_rate).toBeNull();
  });
});
