import { handleResendWebhook } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("Database operation failed"); }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
Deno.serve((request) => handleResendWebhook(request, {
  readSecrets: async () => (await rpc<{ organizationId: string; secret: string }[] | null>("read_resend_webhook_secrets", {})) ?? [],
  record: (organizationIds, providerId, type, at) => rpc<void>("record_email_event", { p_org_ids: organizationIds, p_provider_id: providerId, p_type: type, p_at: at }),
  now: () => new Date(),
}));
