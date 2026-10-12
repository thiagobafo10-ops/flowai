import { createAuthorize } from "../_shared/auth.ts";
import { createMetaRepository } from "../_shared/meta-repository.ts";
import { handleSendMessage, type SendClaim, type SendResult } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const repository = createMetaRepository(url, key, fetch);
async function rpc<T>(name: string, body: unknown): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Database operation failed");
  const text = await response.text(); return (text ? JSON.parse(text) : undefined) as T;
}
Deno.serve((request) => handleSendMessage(request, {
  authorize: createAuthorize(url, anon, fetch),
  readIntent: async (id) => {
    const params = new URLSearchParams({ id: `eq.${id}`, select: "id,organization_id,actor_id,message_id,state,kind" });
    const response = await fetch(`${url}/rest/v1/instagram_send_intents?${params}`, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error("Database operation failed");
    const [item] = await response.json();
    return item ? { id: item.id, organizationId: item.organization_id, actorId: item.actor_id, messageId: item.message_id, state: item.state, kind: item.kind } : null;
  },
  claim: (id) => rpc<SendClaim | null>("claim_instagram_send", { p_intent_id: id }),
  complete: (id, result: SendResult) => rpc<void>("complete_instagram_send", { p_intent_id: id, p_result: result }),
  readConnectionSecrets: repository.readConnectionSecrets, verifyConnection: repository.verifyConnection, fetch, now: () => new Date(),
}));
