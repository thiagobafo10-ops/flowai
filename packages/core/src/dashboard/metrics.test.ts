import { describe, expect, it } from "vitest";
import { dashboardMetricsSchema, toChartData } from "./metrics.ts";

const sample = {
  period_days: 7,
  has_activity: true,
  kpis: {
    conversations_today: 0,
    new_contacts: 0,
    leads: 0,
    opportunities: 0,
    potential_value: 0,
    ai_handled_conversations: 0,
    handoffs: 0,
    resolution_rate: null,
    conversion_rate: null,
  },
  series: {
    conversations_per_day: [{ day: "2026-10-03", count: 2 }],
    ai_vs_handoff_per_day: [{ day: "2026-10-03", ai: 1, handoff: 3 }],
  },
  funnel: [{ stage_id: "abc", name: "Novo", position: 0, count: 4, value: 10 }],
};

describe("dashboardMetricsSchema", () => {
  it("accepts the spec sample", () => {
    expect(dashboardMetricsSchema.safeParse(sample).success).toBe(true);
  });
  it("rejects missing kpis", () => {
    const { kpis: _k, ...rest } = sample;
    expect(dashboardMetricsSchema.safeParse(rest).success).toBe(false);
  });
  it("coerces string numbers", () => {
    const r = dashboardMetricsSchema.parse({ ...sample, kpis: { ...sample.kpis, potential_value: "1000.00" } });
    expect(r.kpis.potential_value).toBe(1000);
  });
  it("keeps null rates and accepts numeric rates", () => {
    const r = dashboardMetricsSchema.parse({ ...sample, kpis: { ...sample.kpis, resolution_rate: 0.5 } });
    expect(r.kpis.resolution_rate).toBe(0.5);
    expect(r.kpis.conversion_rate).toBeNull();
  });
});

describe("toChartData", () => {
  it("maps labels and funnel", () => {
    const d = toChartData(dashboardMetricsSchema.parse(sample));
    expect(d.conversations).toEqual([{ label: "03/10", count: 2 }]);
    expect(d.aiVsHandoff).toEqual([{ label: "03/10", ai: 1, handoff: 3 }]);
    expect(d.funnel).toEqual([{ name: "Novo", count: 4, value: 10 }]);
  });
});
