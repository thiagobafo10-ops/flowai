import {
  analyticsMetricsSchema,
  analyticsPeriodToDays,
  type AnalyticsMetrics,
  type AnalyticsPeriod,
} from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";

export type SupabaseRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
};

/**
 * Consulta a RPC analytics_metrics com a sessão do usuário (RLS) e valida o retorno com Zod.
 */
export async function getAnalyticsMetrics(
  orgId: string,
  period: AnalyticsPeriod,
  channelId?: string | null,
  clientOverride?: SupabaseRpcClient,
): Promise<AnalyticsMetrics> {
  const client = (clientOverride ?? (await createServerClient())) as unknown as SupabaseRpcClient;
  const { data, error } = await client.rpc("analytics_metrics", {
    p_org: orgId,
    p_days: analyticsPeriodToDays(period),
    p_channel_id: channelId || null,
  });

  if (error) {
    throw new Error("Falha ao carregar métricas de analytics", { cause: error });
  }

  const parsed = analyticsMetricsSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Resposta inválida de analytics_metrics", { cause: parsed.error });
  }

  return parsed.data;
}
