import { z } from "zod";

export const analyticsPeriodSchema = z.enum(["1d", "7d", "30d", "90d"]);
export type AnalyticsPeriod = z.infer<typeof analyticsPeriodSchema>;

const numeric = z.union([
  z.number().finite(),
  z
    .string()
    .refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "invalid number")
    .transform((v) => Number(v)),
]);

const num = numeric;
const nullableRate = numeric.nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const analyticsSummarySchema = z.object({
  total_conversations: num,
  conversations_trend: nullableRate,
  resolution_rate: nullableRate,
  resolution_trend: nullableRate,
  new_contacts: num,
  contacts_trend: nullableRate,
  new_leads: num,
  total_pipeline_value: num,
  won_deals_value: num,
  conversion_rate: nullableRate,
  ai_containment_rate: nullableRate,
});

export const analyticsConversationsSectionSchema = z.object({
  daily_volume: z.array(
    z.object({
      day,
      received: num,
      resolved: num,
    }),
  ),
  by_channel: z.array(
    z.object({
      channel_id: z.string(),
      channel_name: z.string(),
      channel_type: z.string(),
      count: num,
    }),
  ),
  by_status: z.array(
    z.object({
      status: z.enum(["open", "waiting", "closed"]),
      count: num,
    }),
  ),
});

export const analyticsAiSectionSchema = z.object({
  daily_ai_vs_human: z.array(
    z.object({
      day,
      ai_replied: num,
      handoffs: num,
    }),
  ),
  total_ai_messages: num,
  total_handoffs: num,
  top_handoff_reasons: z.array(
    z.object({
      reason: z.string(),
      count: num,
    }),
  ),
});

export const analyticsCrmSectionSchema = z.object({
  funnel: z.array(
    z.object({
      stage_id: z.string(),
      stage_name: z.string(),
      position: num,
      count: num,
      value: num,
    }),
  ),
  daily_deals: z.array(
    z.object({
      day,
      created: num,
      won: num,
    }),
  ),
  avg_ticket: num,
});

export const analyticsMetricsSchema = z.object({
  period_days: num,
  period_label: z.string(),
  has_activity: z.boolean(),
  summary: analyticsSummarySchema,
  conversations_section: analyticsConversationsSectionSchema,
  ai_section: analyticsAiSectionSchema,
  crm_section: analyticsCrmSectionSchema,
});

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
export type AnalyticsConversationsSection = z.infer<typeof analyticsConversationsSectionSchema>;
export type AnalyticsAiSection = z.infer<typeof analyticsAiSectionSchema>;
export type AnalyticsCrmSection = z.infer<typeof analyticsCrmSectionSchema>;
export type AnalyticsMetrics = z.infer<typeof analyticsMetricsSchema>;
