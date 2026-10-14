import { createMetaRepository } from "../_shared/meta-repository.ts";
import { createOpenAIProvider } from "../_shared/openai.ts";
import { DbError, handleAutomationWorker, type AppliedStep, type PreparedRun, type RunClaim, type DeliveryClaim, type PreparedDelivery, type CompletedDelivery } from "./handler.ts";
import type { SendClaim } from "../send-message/handler.ts";
import type { KnowledgeHit } from "../../../packages/core/src/ai/index.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const chatModel = Deno.env.get("AI_CHAT_MODEL") || "gpt-4.1-mini";
const repository = createMetaRepository(url, key, fetch);
const provider = createOpenAIProvider({
  apiKey: Deno.env.get("OPENAI_API_KEY"), baseUrl: Deno.env.get("OPENAI_BASE_URL") || undefined,
  chatModel, embeddingModel: Deno.env.get("AI_EMBEDDING_MODEL") || undefined, fetch,
});

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    let code: string | null = null;
    try { const body = await response.json(); if (typeof body?.code === "string") code = body.code; } catch { /* no response text in errors */ }
    throw new DbError(code);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
type MatchRow = { id: string; document_title: string; content: string; similarity: number };

Deno.serve((request) => handleAutomationWorker(request, {
  readWorkerSecret: async () => (await rpc<{ workerSecret: string } | null>("read_automation_worker_config", {}))?.workerSecret ?? null,
  claimRuns: (limit) => rpc<RunClaim[]>("claim_automation_runs", { p_limit: limit }),
  prepareRun: (run, token) => rpc<PreparedRun>("prepare_automation_run", { p_run: run, p_token: token }),
  buttonPayloads: (run, token, node) => rpc<Record<string, string>>("automation_button_payloads", { p_run: run, p_token: token, p_node_id: node }),
  applyStep: (run, token, step) => rpc<AppliedStep>("apply_automation_step", { p_run: run, p_token: token, p_step: step }),
  failRun: (run, token, code, retryable) => rpc<void>("fail_automation_run", { p_run: run, p_token: token, p_code: code, p_retryable: retryable }),
  yieldRun: (run, token) => rpc<void>("yield_automation_run", { p_run: run, p_token: token }),
  claimDeliveries: (limit) => rpc<DeliveryClaim[]>("claim_outreach_deliveries", { p_limit: limit }),
  prepareDelivery: (id, token) => rpc<PreparedDelivery>("prepare_outreach_delivery", { p_id: id, p_token: token }),
  completeDelivery: (id, token, result) => rpc<CompletedDelivery>("complete_outreach_delivery", { p_id: id, p_token: token, p_result: result }),
  failDelivery: (id, token, code, retryable) => rpc<void>("fail_outreach_delivery", { p_id: id, p_token: token, p_code: code, p_retryable: retryable }),
  searchKnowledge: async (org, embedding): Promise<KnowledgeHit[]> => {
    const rows = await rpc<MatchRow[]>("match_knowledge_chunks", { p_org: org, p_embedding: `[${embedding.join(",")}]`, p_k: 5, p_min_similarity: 0.3 });
    return rows.map((row) => ({ id: row.id, documentTitle: row.document_title, content: row.content, similarity: row.similarity }));
  },
  claimSend: (id) => rpc<SendClaim | null>("claim_instagram_send", { p_intent_id: id }),
  complete: (id, result) => rpc<void>("complete_instagram_send", { p_intent_id: id, p_result: result }),
  readConnectionSecrets: repository.readConnectionSecrets, verifyConnection: repository.verifyConnection,
  provider, chatModel, fetch, now: () => new Date(),
}));
