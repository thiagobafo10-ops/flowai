import { createServerClient } from "@/lib/supabase/server";

export type InstagramConnectionView = { id: string; channelId: string; name: string; status: string; accountId: string; appId: string; apiVersion: string; tokenVerified: boolean; webhookVerified: boolean; disconnected: boolean; lastError: string | null; callbackUrl: string };
export type InstagramRuleView = { id: string; channelId: string; keyword: string; replyText: string; mediaId: string | null; active: boolean; lastState: string | null; lastError: string | null };
export async function listInstagramSettings(orgId: string): Promise<{ connections: InstagramConnectionView[]; rules: InstagramRuleView[] }> {
  const db = await createServerClient();
  const [connections, channels, rules, events] = await Promise.all([
    db.from("meta_connections").select("id,app_id,api_version,token_verified_at,webhook_verified_at,disconnected_at,last_error").eq("organization_id", orgId).order("created_at"),
    db.from("channels").select("id,name,status,external_account_id,meta_connection_id").eq("organization_id", orgId).eq("type", "instagram"),
    db.from("instagram_comment_rules").select("id,channel_id,keyword,reply_text,media_id,active").eq("organization_id", orgId).order("created_at").order("id"),
    db.from("instagram_events").select("rule_id,state,last_error,created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(100),
  ]);
  for (const result of [connections, channels, rules, events]) if (result.error) throw new Error("Não foi possível carregar as configurações do Instagram.");
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return {
    connections: (connections.data ?? []).flatMap((connection) => (channels.data ?? []).filter((channel) => channel.meta_connection_id === connection.id).map((channel) => ({ id: connection.id, channelId: channel.id, name: channel.name, status: channel.status, accountId: channel.external_account_id ?? "", appId: connection.app_id, apiVersion: connection.api_version, tokenVerified: !!connection.token_verified_at, webhookVerified: !!connection.webhook_verified_at, disconnected: !!connection.disconnected_at, lastError: connection.last_error, callbackUrl: `${baseUrl}/functions/v1/meta-webhook/${connection.id}` }))),
    rules: (rules.data ?? []).map((rule) => { const latest = (events.data ?? []).find((event) => event.rule_id === rule.id); return { id: rule.id, channelId: rule.channel_id, keyword: rule.keyword, replyText: rule.reply_text, mediaId: rule.media_id, active: rule.active, lastState: latest?.state ?? null, lastError: latest?.last_error ?? null }; }),
  };
}
