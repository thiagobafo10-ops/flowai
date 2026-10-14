/** Test-only local proxy. Real Auth/REST/RLS; Graph boundary is injected here. */
import { createOpenAIProvider } from "../_shared/openai.ts";
import { createFakeOpenAIFetch } from "./fake-openai.ts";
import { DbError, handleAutomationWorker, type AppliedStep, type PreparedRun, type RunClaim } from "../automation-worker/handler.ts";
import type { KnowledgeHit } from "../../../packages/core/src/ai/index.ts";
import { createAuthorize } from "../_shared/auth.ts";
import { createMetaRepository } from "../_shared/meta-repository.ts";
import { handleMetaConnection } from "../meta-connection/handler.ts";
import { handleMetaWebhook } from "../meta-webhook/handler.ts";
import { handleSendMessage, type SendClaim } from "../send-message/handler.ts";
import { handleInstagramWorker, type InstagramWork, type PreparedComment, type PreparedProfile } from "../instagram-worker/handler.ts";

const url = "http://127.0.0.1:54321";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
if (!service || !anon) throw new Error("Local e2e credentials required");
const headers = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
const repo = createMetaRepository(url, service, fetch);
const authorize = createAuthorize(url, anon, fetch);
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });
  if (!response.ok) {
    let code: string | null = null;
    try { const body = await response.json(); if (typeof body?.code === "string") code = body.code; } catch { /* no payload in errors */ }
    throw new DbError(code);
  }
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
  if (endpoint.searchParams.get("fields") === "name,username") return Response.json({ name: "Cliente Instagram", username: "cliente_ig" });
  if (endpoint.searchParams.get("fields") === "id,owner") return Response.json({ id: resource, owner: { id: resource === "80099" ? "foreign-account" : token } });
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
  prepareProfile: (id: string) => rpc<PreparedProfile | null>("prepare_instagram_profile", { p_event_id: id }),
  saveContactName: (id: string, name: string) => rpc<void>("save_instagram_contact_name", { p_event_id: id, p_name: name }),
  reselect: (id: string, at: string) => rpc<PreparedComment | null>("reselect_instagram_comment_rule", { p_event_id: id, p_comment_at: at }),
  finishWork: (id: number, state: string, error: string | null) => rpc<void>("finish_instagram_work", { p_queue_id: id, p_state: state, p_error_code: error }),
};

const fakeFetch = createFakeOpenAIFetch();
const provider = createOpenAIProvider({ apiKey: "e2e-fake", chatModel: "gpt-4.1-mini", fetch: fakeFetch });
const automationDeps = {
  ...sendDeps,
  readWorkerSecret: async () => (await rpc<{ workerSecret: string } | null>("read_automation_worker_config", {}))?.workerSecret ?? null,
  claimRuns: (limit: number) => rpc<RunClaim[]>("claim_automation_runs", { p_limit: limit }),
  prepareRun: (run: string, token: string) => rpc<PreparedRun>("prepare_automation_run", { p_run: run, p_token: token }),
  buttonPayloads: (run: string, token: string, node: string) => rpc<Record<string, string>>("automation_button_payloads", { p_run: run, p_token: token, p_node_id: node }),
  applyStep: (run: string, token: string, step: unknown) => rpc<AppliedStep>("apply_automation_step", { p_run: run, p_token: token, p_step: step }),
  failRun: (run: string, token: string, code: string, retryable: boolean) => rpc<void>("fail_automation_run", { p_run: run, p_token: token, p_error_code: code, p_retryable: retryable }),
  yieldRun: (run: string, token: string) => rpc<void>("yield_automation_run", { p_run: run, p_token: token }),
  searchKnowledge: async (org: string, embedding: number[]): Promise<KnowledgeHit[]> => {
    const rows = await rpc<{ id: string; document_title: string; content: string; similarity: number }[]>("match_knowledge_chunks", { p_org: org, p_embedding: "[" + embedding.join(",") + "]", p_k: 5, p_min_similarity: 0.3 });
    return rows.map((row) => ({ id: row.id, documentTitle: row.document_title, content: row.content, similarity: row.similarity }));
  },
  claimSend: sendDeps.claim, provider, chatModel: "gpt-4.1-mini",
};

Deno.serve({ hostname: "127.0.0.1", port: Number(Deno.env.get("FLOWAI_E2E_PROXY_PORT") ?? "54328") }, async (request) => {
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
  if (parsed.pathname === "/__test__/openai-calls") return Response.json(fakeFetch.calls.map((call) => ({ path: call.path })));
  if (parsed.pathname === "/__test__/run-automation-worker") {
    const secret = await automationDeps.readWorkerSecret();
    return handleAutomationWorker(new Request("http://local/worker", { method: "POST", headers: { "x-flowai-worker": secret ?? "" } }), automationDeps);
  }
  if (parsed.pathname === "/functions/v1/automation-worker") return handleAutomationWorker(request, automationDeps);
  if (parsed.pathname === "/functions/v1/instagram-worker") return handleInstagramWorker(request, workerDeps);
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
