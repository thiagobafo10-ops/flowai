/** Test-only local proxy. Real Auth/REST/RLS; Graph boundary is injected here. */
import { createAuthorize } from "../_shared/auth.ts";
import { createMetaRepository } from "../_shared/meta-repository.ts";
import { handleMetaConnection } from "../meta-connection/handler.ts";
import { handleMetaWebhook } from "../meta-webhook/handler.ts";
import { handleSendMessage, type SendClaim } from "../send-message/handler.ts";
import { handleInstagramWorker, type InstagramWork, type PreparedComment } from "../instagram-worker/handler.ts";

const url = "http://127.0.0.1:54321";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
if (!service || !anon) throw new Error("Local e2e credentials required");
const headers = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
const repo = createMetaRepository(url, service, fetch);
const authorize = createAuthorize(url, anon, fetch);
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
  if (!response.ok) throw new Error(`Test RPC failed: ${name}`);
  const text = await response.text(); return (text ? JSON.parse(text) : undefined) as T;
}
const graphCalls: { accountId: string; body: unknown }[] = [];
const graphFetch: typeof fetch = async (input, init) => {
  const endpoint = new URL(String(input));
  if (endpoint.hostname !== "graph.instagram.com") throw new Error("Unexpected external host in test");
  const token = new Headers(init?.headers).get("authorization")?.replace("Bearer e2e-account-", "") ?? "";
  if (!/^\d+$/.test(token)) return Response.json({ error: { code: 190 } }, { status: 401 });
  const resource = endpoint.pathname.split("/").at(-1)!;
  if (resource === "me") return Response.json({ user_id: token, username: "empresa_teste" });
  if (resource === "subscribed_apps") return Response.json({ success: true });
  if (resource === "messages") {
    const body = JSON.parse(String(init?.body)); graphCalls.push({ accountId: token, body });
    let recipientId = body.recipient.id;
    if (body.recipient.comment_id) {
      const response = await fetch(`${url}/rest/v1/instagram_events?kind=eq.comment&external_id=eq.${encodeURIComponent(body.recipient.comment_id)}&select=payload`, { headers });
      recipientId = (await response.json())[0]?.payload.senderExternalId;
    }
    return Response.json({ message_id: `e2e-out-${crypto.randomUUID()}`, recipient_id: recipientId });
  }
  if (endpoint.searchParams.get("fields") === "id,owner") return Response.json({ id: resource, owner: { id: token } });
  const response = await fetch(`${url}/rest/v1/instagram_events?kind=eq.comment&external_id=eq.${encodeURIComponent(resource)}&select=payload,created_at`, { headers });
  const [event] = await response.json();
  return event ? Response.json({ id: resource, timestamp: event.created_at, from: { id: event.payload.senderExternalId }, media: { id: event.payload.mediaId, media_product_type: "REELS" } }) : Response.json({ error: { code: 100 } }, { status: 404 });
};
const sendDeps = {
  readConnectionSecrets: repo.readConnectionSecrets, verifyConnection: repo.verifyConnection,
  fetch: graphFetch, now: () => new Date(),
  complete: (id: string, result: unknown) => rpc<void>("complete_instagram_send", { p_intent_id: id, p_result: result }),
  claim: (id: string) => rpc<SendClaim | null>("claim_instagram_send", { p_intent_id: id }),
};
const workerDeps = {
  ...sendDeps,
  readWorkerSecret: async () => (await rpc<{ workerSecret: string } | null>("read_instagram_worker_config", {}))?.workerSecret ?? null,
  readWork: (limit: number) => rpc<InstagramWork[]>("read_instagram_work", { p_limit: limit }),
  prepare: (id: string) => rpc<PreparedComment | null>("prepare_instagram_comment_send", { p_event_id: id }),
  reselect: (id: string, at: string) => rpc<PreparedComment | null>("reselect_instagram_comment_rule", { p_event_id: id, p_comment_at: at }),
  finishWork: (id: number, state: string, error: string | null) => rpc<void>("finish_instagram_work", { p_queue_id: id, p_state: state, p_error_code: error }),
};

Deno.serve({ hostname: "127.0.0.1", port: 54326 }, async (request) => {
  const parsed = new URL(request.url);
  if (request.headers.get("upgrade") === "websocket") {
    const { socket, response } = Deno.upgradeWebSocket(request);
    const upstream = new WebSocket(`ws://127.0.0.1:54321${parsed.pathname}${parsed.search}`);
    upstream.binaryType = "arraybuffer"; const pending: (string | ArrayBuffer)[] = [];
    socket.onmessage = (event) => upstream.readyState === WebSocket.OPEN ? upstream.send(event.data) : pending.push(event.data);
    upstream.onopen = () => { for (const item of pending) upstream.send(item); };
    upstream.onmessage = (event) => { if (socket.readyState === WebSocket.OPEN) socket.send(event.data); };
    socket.onclose = () => { if (upstream.readyState === WebSocket.OPEN) upstream.close(); };
    upstream.onclose = () => { if (socket.readyState === WebSocket.OPEN) socket.close(); };
    return response;
  }
  if (parsed.pathname === "/__test__/graph-calls") return Response.json(graphCalls);
  if (parsed.pathname === "/__test__/run-worker") {
    const secret = await workerDeps.readWorkerSecret();
    return handleInstagramWorker(new Request("http://local/worker", { method: "POST", headers: { "x-flowai-worker": secret ?? "" } }), workerDeps);
  }
  if (parsed.pathname.startsWith("/functions/v1/meta-webhook/")) return handleMetaWebhook(request, {
    readConnectionSecrets: repo.readConnectionSecrets, verifyConnection: repo.verifyConnection,
    allowIp: async () => true, allowConnection: async () => true, ingestEvent: (id, event) => rpc("ingest_instagram_event", { p_connection_id: id, p_event: event }),
  });
  if (parsed.pathname === "/functions/v1/meta-connection") return handleMetaConnection(request, { authorize, repository: repo, fetch: graphFetch });
  if (parsed.pathname === "/functions/v1/send-message") return handleSendMessage(request, {
    ...sendDeps, authorize,
    readIntent: async (id) => {
      const response = await fetch(`${url}/rest/v1/instagram_send_intents?id=eq.${id}&select=id,organization_id,actor_id,message_id,state,kind`, { headers });
      const [item] = await response.json(); return item ? { id: item.id, organizationId: item.organization_id, actorId: item.actor_id, messageId: item.message_id, state: item.state, kind: item.kind } : null;
    },
  });
  const proxied = new Request(`${url}${parsed.pathname}${parsed.search}`, request);
  return fetch(proxied);
});
