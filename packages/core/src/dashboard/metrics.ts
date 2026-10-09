import { z } from "zod";

const num = z.coerce.number();
const rate = z.preprocess((v) => (v === null || v === undefined ? null : v), z.coerce.number().nullable());

export const dashboardMetricsSchema = z.object({
  period_days: num,
  has_activity: z.boolean(),
  kpis: z.object({
    conversations_today: num,
    new_contacts: num,
    leads: num,
    opportunities: num,
    potential_value: num,
    ai_handled_conversations: num,
    handoffs: num,
    resolution_rate: rate,
    conversion_rate: rate,
  }),
  series: z.object({
    conversations_per_day: z.array(z.object({ day: z.string(), count: num })),
    ai_vs_handoff_per_day: z.array(z.object({ day: z.string(), ai: num, handoff: num })),
  }),
  funnel: z.array(
    z.object({
      stage_id: z.string(),
      name: z.string(),
      position: num,
      count: num,
      value: num,
    }),
  ),
});

export type DashboardMetrics = z.infer<typeof dashboardMetricsSchema>;

function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

export function toChartData(m: DashboardMetrics): {
  conversations: { label: string; count: number }[];
  aiVsHandoff: { label: string; ai: number; handoff: number }[];
  funnel: { name: string; count: number; value: number }[];
} {
  return {
    conversations: m.series.conversations_per_day.map((p) => ({ label: dayLabel(p.day), count: p.count })),
    aiVsHandoff: m.series.ai_vs_handoff_per_day.map((p) => ({
      label: dayLabel(p.day),
      ai: p.ai,
      handoff: p.handoff,
    })),
    funnel: m.funnel.map((f) => ({ name: f.name, count: f.count, value: f.value })),
  };
}
