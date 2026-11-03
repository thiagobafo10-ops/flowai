import { handleYampiWebhook } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Database operation failed");
  return await response.json();
}
Deno.serve((request) => handleYampiWebhook(request, {
  readConnection: (id) => rpc("read_yampi_connection", { p_connection: id }),
  allowIp: (ip) => rpc<boolean>("check_rate_limit", { p_key: `yampi-ip:${ip}`, p_limit: 600, p_window_seconds: 60 }),
  ingest: (id, event, bodyHash) => rpc("ingest_yampi_event", { p_connection: id, p_event: event, p_body_hash: bodyHash }),
}));
