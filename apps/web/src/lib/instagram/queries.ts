import { createServerClient } from "@/lib/supabase/server";

export type InstagramConnectionView = { id: string; channelId: string; name: string; status: string; accountId: string; appId: string; apiVersion: string; tokenVerified: boolean; webhookVerified: boolean; disconnected: boolean; lastError: string | null; callbackUrl: string };
/** Conexões do Instagram. As regras de comentário viraram automações e não são mais carregadas aqui. */
export async function listInstagramSettings(orgId: string): Promise<{ connections: InstagramConnectionView[] }> {
  const db = await createServerClient();
  const [connections, channels] = await Promise.all([
    db.from("meta_connections").select("id,app_id,api_version,token_verified_at,webhook_verified_at,disconnected_at,last_error").eq("organization_id", orgId).order("created_at"),
    db.from("channels").select("id,name,status,external_account_id,meta_connection_id").eq("organization_id", orgId).eq("type", "instagram"),
  ]);
  for (const result of [connections, channels]) if (result.error) throw new Error("Não foi possível carregar as configurações do Instagram.");
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return {
    connections: (connections.data ?? []).flatMap((connection) => (channels.data ?? []).filter((channel) => channel.meta_connection_id === connection.id).map((channel) => ({ id: connection.id, channelId: channel.id, name: channel.name, status: channel.status, accountId: channel.external_account_id ?? "", appId: connection.app_id, apiVersion: connection.api_version, tokenVerified: !!connection.token_verified_at, webhookVerified: !!connection.webhook_verified_at, disconnected: !!connection.disconnected_at, lastError: connection.last_error, callbackUrl: `${baseUrl}/functions/v1/meta-webhook/${connection.id}` }))),
  };
}
