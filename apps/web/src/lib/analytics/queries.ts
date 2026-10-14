import {
  analyticsMetricsSchema,
  periodToDays,
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
  const supabase = clientOverride ?? (await createServerClient());
  const { data, error } = await supabase.rpc("analytics_metrics", {
    p_org: orgId,
    p_days: periodToDays(period),
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
