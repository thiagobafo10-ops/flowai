import { opsHealthSchema, type OpsHealth } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";

export type SupabaseRpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
};

/**
 * Consulta a RPC ops_health com a sessão do usuário e valida o retorno com Zod.
 * A função do banco exige administrador da própria organização.
 */
export async function getOpsHealth(
  orgId: string,
  clientOverride?: SupabaseRpcClient,
): Promise<OpsHealth> {
  const client = (clientOverride ?? (await createServerClient())) as unknown as SupabaseRpcClient;
  const { data, error } = await client.rpc("ops_health", { p_org: orgId });

  if (error) {
    throw new Error("Falha ao carregar a saúde da operação", { cause: error });
  }

  const parsed = opsHealthSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Resposta inválida de ops_health", { cause: parsed.error });
  }

  return parsed.data;
}
