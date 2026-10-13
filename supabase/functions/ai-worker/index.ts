import { createMetaRepository } from "../_shared/meta-repository.ts";
import { createOpenAIProvider } from "../_shared/openai.ts";
import { DbError, handleAiWorker, type AiJob, type IndexChunk, type PreparedIndex, type PreparedReply } from "./handler.ts";
import type { SendClaim } from "../send-message/handler.ts";
import type { KnowledgeHit } from "../../../packages/core/src/ai/index.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const chatModel = Deno.env.get("AI_CHAT_MODEL") || "gpt-4.1-mini";
const repository = createMetaRepository(url, key, fetch);
const provider = createOpenAIProvider({
  apiKey: Deno.env.get("OPENAI_API_KEY"),
  baseUrl: Deno.env.get("OPENAI_BASE_URL") || undefined,
  chatModel,
  embeddingModel: Deno.env.get("AI_EMBEDDING_MODEL") || undefined,
  fetch,
});
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(30000) });
  if (!response.ok) {
    let code: string | null = null;
    try { const body = await response.json(); if (typeof body?.code === "string") code = body.code; } catch { /* ignore */ }
    throw new DbError(code);
  }
  const text = await response.text(); return (text ? JSON.parse(text) : undefined) as T;
}
type MatchRow = { id: string; document_title: string; content: string; similarity: number };
Deno.serve((request) => handleAiWorker(request, {
  readWorkerSecret: async () => (await rpc<{ workerSecret: string } | null>("read_ai_worker_config", {}))?.workerSecret ?? null,
  claimJobs: (limit) => rpc<AiJob[]>("claim_ai_jobs", { p_limit: limit }),
  prepareReply: (job, token) => rpc<PreparedReply>("prepare_ai_reply", { p_job: job, p_token: token }),
  completeReply: (job, token, result) => rpc("complete_ai_reply", { p_job: job, p_token: token, p_result: result }),
  handoffJob: (job, token, reason) => rpc("handoff_ai_job", { p_job: job, p_token: token, p_reason: reason }),
  prepareIndex: (job, token) => rpc<PreparedIndex | null>("prepare_index_document", { p_job: job, p_token: token }),
  completeIndex: (job, token, chunks: IndexChunk[]) => rpc("complete_index_document", { p_job: job, p_token: token, p_chunks: chunks }),
  failJob: (job, token, code, retryable) => rpc<void>("fail_ai_job", { p_job: job, p_token: token, p_error_code: code, p_retryable: retryable }),
  searchKnowledge: async (org, embedding): Promise<KnowledgeHit[]> => {
    const rows = await rpc<MatchRow[]>("match_knowledge_chunks", { p_org: org, p_embedding: `[${embedding.join(",")}]`, p_k: 5, p_min_similarity: 0.3 });
    return rows.map((row) => ({ id: row.id, documentTitle: row.document_title, content: row.content, similarity: row.similarity }));
  },
  claimSend: (id) => rpc<SendClaim | null>("claim_instagram_send", { p_intent_id: id }),
  complete: (id, result) => rpc<void>("complete_instagram_send", { p_intent_id: id, p_result: result }),
  readConnectionSecrets: repository.readConnectionSecrets, verifyConnection: repository.verifyConnection,
  provider, chatModel, fetch, now: () => new Date(),
}));
