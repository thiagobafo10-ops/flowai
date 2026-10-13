/** Test-only local proxy. Real Auth/REST/RLS/Realtime; the OpenAI boundary is a local fake. */
import { createAuthorize } from "../_shared/auth.ts";
import { createMetaRepository } from "../_shared/meta-repository.ts";
import { createOpenAIProvider } from "../_shared/openai.ts";
import { DbError, handleAiWorker, type AiJob, type IndexChunk, type PreparedIndex, type PreparedReply } from "../ai-worker/handler.ts";
import { handleAiPlayground, type PlaygroundContext } from "../ai-playground/handler.ts";
import type { SendClaim } from "../send-message/handler.ts";
import type { KnowledgeHit } from "../../../packages/core/src/ai/index.ts";
import { createFakeOpenAIFetch } from "./fake-openai.ts";

const url = "http://127.0.0.1:54321";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
if (!service || !anon) throw new Error("Local e2e credentials required");
const headers = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
const repo = createMetaRepository(url, service, fetch);
const authorize = createAuthorize(url, anon, fetch);
const chatModel = "gpt-4.1-mini";
const fakeFetch = createFakeOpenAIFetch();
const provider = createOpenAIProvider({ apiKey: "e2e-fake", chatModel, fetch: fakeFetch });
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args), signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    let code: string | null = null;
    try { const body = await response.json(); if (typeof body?.code === "string") code = body.code; } catch { /* ignore */ }
    throw new DbError(code);
  }
  const text = await response.text(); return (text ? JSON.parse(text) : undefined) as T;
}
type MatchRow = { id: string; document_title: string; content: string; similarity: number };
const searchKnowledge = async (org: string, embedding: number[]): Promise<KnowledgeHit[]> => {
  const rows = await rpc<MatchRow[]>("match_knowledge_chunks", { p_org: org, p_embedding: `[${embedding.join(",")}]`, p_k: 5, p_min_similarity: 0.3 });
  return rows.map((row) => ({ id: row.id, documentTitle: row.document_title, content: row.content, similarity: row.similarity }));
};
const noExternalFetch: typeof fetch = () => { throw new Error("Unexpected external call in test"); };
const workerDeps = {
  readWorkerSecret: async () => (await rpc<{ workerSecret: string } | null>("read_ai_worker_config", {}))?.workerSecret ?? null,
  claimJobs: (limit: number) => rpc<AiJob[]>("claim_ai_jobs", { p_limit: limit }),
  prepareReply: (job: string, token: string) => rpc<PreparedReply>("prepare_ai_reply", { p_job: job, p_token: token }),
  completeReply: (job: string, token: string, result: unknown) => rpc("complete_ai_reply", { p_job: job, p_token: token, p_result: result }),
  handoffJob: (job: string, token: string, reason: string) => rpc("handoff_ai_job", { p_job: job, p_token: token, p_reason: reason }),
  prepareIndex: (job: string, token: string) => rpc<PreparedIndex | null>("prepare_index_document", { p_job: job, p_token: token }),
  completeIndex: (job: string, token: string, chunks: IndexChunk[]) => rpc("complete_index_document", { p_job: job, p_token: token, p_chunks: chunks }),
  failJob: (job: string, token: string, code: string, retryable: boolean) => rpc<void>("fail_ai_job", { p_job: job, p_token: token, p_error_code: code, p_retryable: retryable }),
  searchKnowledge,
  claimSend: (id: string) => rpc<SendClaim | null>("claim_instagram_send", { p_intent_id: id }),
  complete: (id: string, result: unknown) => rpc<void>("complete_instagram_send", { p_intent_id: id, p_result: result }),
  readConnectionSecrets: repo.readConnectionSecrets, verifyConnection: repo.verifyConnection,
  provider, chatModel, fetch: noExternalFetch, now: () => new Date(),
};

Deno.serve({ hostname: "127.0.0.1", port: 54327 }, async (request) => {
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
  if (parsed.pathname === "/__test__/run-ai-worker") {
    const secret = await workerDeps.readWorkerSecret();
    return handleAiWorker(new Request("http://local/worker", { method: "POST", headers: { "x-flowai-worker": secret ?? "" } }), workerDeps);
  }
  if (parsed.pathname === "/functions/v1/ai-playground") return handleAiPlayground(request, {
    authorize, provider, chatModel, configured: true,
    prepare: (org) => rpc<PlaygroundContext | null>("prepare_ai_playground", { p_org: org }),
    consumeTest: (org) => rpc<boolean>("consume_ai_quota", { p_org: org, p_kind: "test" }),
    searchKnowledge,
  });
  const proxied = new Request(`${url}${parsed.pathname}${parsed.search}`, request);
  return fetch(proxied);
});
