import { describe, expect, it, vi } from "vitest";
import { getAnalyticsMetrics } from "./queries";

const mockMetricsPayload = {
  period_days: 7,
  period_label: "Últimos 7 dias",
  has_activity: true,
  summary: {
    total_conversations: 40,
    conversations_trend: 10,
    resolution_rate: 75,
    resolution_trend: 5,
    new_contacts: 15,
    contacts_trend: 0,
    new_leads: 8,
    total_pipeline_value: 20000,
    won_deals_value: 5000,
    conversion_rate: 20,
    ai_containment_rate: 55,
  },
  conversations_section: {
    daily_volume: [{ day: "2026-10-10", received: 10, resolved: 8 }],
    by_channel: [{ channel_id: "c1", channel_name: "Insta", channel_type: "instagram", count: 40 }],
    by_status: [{ status: "closed", count: 30 }, { status: "open", count: 10 }],
  },
  ai_section: {
    daily_ai_vs_human: [{ day: "2026-10-10", ai_replied: 8, handoffs: 2 }],
    total_ai_messages: 80,
    total_handoffs: 10,
    top_handoff_reasons: [{ reason: "Humano", count: 10 }],
  },
  crm_section: {
    funnel: [{ stage_id: "s1", stage_name: "Novo", position: 1, count: 5, value: 10000 }],
    daily_deals: [{ day: "2026-10-10", created: 1, won: 1 }],
    avg_ticket: 5000,
  },
};

describe("getAnalyticsMetrics", () => {
  it("chama a rpc analytics_metrics com os parâmetros corretos e valida a resposta", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: mockMetricsPayload, error: null });
    const mockClient = { rpc: mockRpc } as any;

    const result = await getAnalyticsMetrics("org-123", "7d", undefined, mockClient);
    expect(mockRpc).toHaveBeenCalledWith("analytics_metrics", {
      p_org: "org-123",
      p_days: 7,
      p_channel_id: null,
    });
    expect(result.summary.total_conversations).toBe(40);
  });

  it("passa o channel_id quando especificado", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: mockMetricsPayload, error: null });
    const mockClient = { rpc: mockRpc } as any;

    await getAnalyticsMetrics("org-123", "30d", "chan-456", mockClient);
    expect(mockRpc).toHaveBeenCalledWith("analytics_metrics", {
      p_org: "org-123",
      p_days: 30,
      p_channel_id: "chan-456",
    });
  });

  it("lança erro caso a rpc retorne erro", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "db error" } });
    const mockClient = { rpc: mockRpc } as any;

    await expect(getAnalyticsMetrics("org-123", "7d", undefined, mockClient)).rejects.toThrow(
      "Falha ao carregar métricas de analytics",
    );
  });
});
