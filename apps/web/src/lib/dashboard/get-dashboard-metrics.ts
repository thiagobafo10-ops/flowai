import {
  dashboardMetricsSchema,
  periodToDays,
  type DashboardMetrics,
  type DashboardPeriod,
} from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";

/** Chama a RPC dashboard_metrics com a sessão do usuário (RLS) e valida o retorno. */
export async function getDashboardMetrics(
  orgId: string,
  period: DashboardPeriod,
): Promise<DashboardMetrics> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("dashboard_metrics", {
    p_org: orgId,
    p_days: periodToDays(period),
  });
  if (error) throw new Error("Falha ao carregar métricas do dashboard", { cause: error });

  const parsed = dashboardMetricsSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Resposta inválida de dashboard_metrics", { cause: parsed.error });
  }
  return parsed.data;
}
