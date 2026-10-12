import { createMetaRepository } from "../_shared/meta-repository.ts";
import { handleMetaWebhook } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const repository = createMetaRepository(url, serviceKey, fetch);
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Database operation failed");
  return await response.json();
}
Deno.serve((request) => handleMetaWebhook(request, {
  readConnectionSecrets: repository.readConnectionSecrets,
  verifyConnection: repository.verifyConnection,
  allowRequest: async (id, ip) => await rpc<boolean>("check_rate_limit", { p_key: `meta:${id}`, p_limit: 300, p_window_seconds: 60 }) && await rpc<boolean>("check_rate_limit", { p_key: `meta-ip:${ip}`, p_limit: 120, p_window_seconds: 60 }),
  ingestEvent: (id, event) => rpc("ingest_instagram_event", { p_connection_id: id, p_event: event }),
}));
