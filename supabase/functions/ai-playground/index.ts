import { createAuthorize } from "../_shared/auth.ts";
import { createOpenAIProvider } from "../_shared/openai.ts";
import { handleAiPlayground, type PlaygroundContext } from "./handler.ts";
import type { KnowledgeHit } from "../../../packages/core/src/ai/index.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const apiKey = Deno.env.get("OPENAI_API_KEY");
const chatModel = Deno.env.get("AI_CHAT_MODEL") || "gpt-4.1-mini";
const provider = createOpenAIProvider({ apiKey, baseUrl: Deno.env.get("OPENAI_BASE_URL") || undefined, chatModel, embeddingModel: Deno.env.get("AI_EMBEDDING_MODEL") || undefined, fetch });

/** Database error carrying the SQLSTATE returned by PostgREST (42501 maps to 403 in the handler). */
class DbError extends Error {
  readonly code: string | null;
  constructor(code: string | null) { super("Database operation failed"); this.name = "DbError"; this.code = code; }
}
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
Deno.serve((request) => handleAiPlayground(request, {
  authorize: createAuthorize(url, anonKey, fetch),
  provider, chatModel, configured: Boolean(apiKey),
  prepare: (org) => rpc<PlaygroundContext | null>("prepare_ai_playground", { p_org: org }),
  consumeTest: (org) => rpc<boolean>("consume_ai_quota", { p_org: org, p_kind: "test" }),
  searchKnowledge: async (org, embedding): Promise<KnowledgeHit[]> => {
    const rows = await rpc<MatchRow[]>("match_knowledge_chunks", { p_org: org, p_embedding: `[${embedding.join(",")}]`, p_k: 5, p_min_similarity: 0.3 });
    return rows.map((row) => ({ id: row.id, documentTitle: row.document_title, content: row.content, similarity: row.similarity }));
  },
}));
