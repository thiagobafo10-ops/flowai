import type { InstagramVipView } from "./vip";
import { createServerClient } from "@/lib/supabase/server";

export type InstagramConnectionView = { id: string; channelId: string; name: string; status: string; accountId: string; appId: string; apiVersion: string; tokenVerified: boolean; webhookVerified: boolean; disconnected: boolean; lastError: string | null; callbackUrl: string; vip?: InstagramVipView };
/** Conexões do Instagram. As regras de comentário viraram automações e não são mais carregadas aqui. */
export async function listInstagramSettings(orgId: string): Promise<{ connections: InstagramConnectionView[] }> {
  const db = await createServerClient();
  const [connections, vip, channels] = await Promise.all([
    db.from("meta_connections").select("id,app_id,api_version,token_verified_at,webhook_verified_at,disconnected_at,last_error").eq("organization_id", orgId).order("created_at"),
    db.from("instagram_vip_settings").select("channel_id,enabled,public_reply_text,group_url,activated_at,last_error,comments_verified_at,comments_error").eq("organization_id", orgId),
    db.from("channels").select("id,name,status,external_account_id,meta_connection_id").eq("organization_id", orgId).eq("type", "instagram"),
  ]);
  for (const result of [connections, channels, vip]) if (result.error) throw new Error("Não foi possível carregar as configurações do Instagram.");
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return {
    connections: (connections.data ?? []).flatMap((connection) => (channels.data ?? []).filter((channel) => channel.meta_connection_id === connection.id).map((channel) => ({ id: connection.id, channelId: channel.id, name: channel.name, status: channel.status, accountId: channel.external_account_id ?? "", appId: connection.app_id, apiVersion: connection.api_version, tokenVerified: !!connection.token_verified_at, webhookVerified: !!connection.webhook_verified_at, disconnected: !!connection.disconnected_at, lastError: connection.last_error, vip: (vip.data ?? []).filter(v => v.channel_id === channel.id).map(v => ({ enabled: v.enabled, publicReplyText: v.public_reply_text, groupUrl: v.group_url, activatedAt: v.activated_at, lastError: v.last_error, commentsVerifiedAt: v.comments_verified_at, commentsError: v.comments_error }))[0], callbackUrl: `${baseUrl}/functions/v1/meta-webhook/${connection.id}` }))),
  };
}
