import type { Authorize } from "../_shared/auth.ts";
import { BodyTooLarge, readLimitedBody } from "../_shared/http.ts";
import { AIProviderError, HANDOFF_LABELS, playgroundInputSchema, runReplyPipeline, type AIProvider, type KnowledgeHit } from "../../../packages/core/src/ai/index.ts";

export type PlaygroundContext = {
  agent: { name: string; personality: string; objective: string; tone: string; systemPrompt: string; humanHandoff?: boolean };
  company: string;
  stages: string[];
};
export type AiPlaygroundDeps = {
  authorize: Authorize;
  provider: AIProvider;
  configured: boolean;
  chatModel: string;
  prepare(orgId: string): Promise<PlaygroundContext | null>;
  consumeTest(orgId: string): Promise<boolean>;
  searchKnowledge(orgId: string, embedding: number[]): Promise<KnowledgeHit[]>;
  /** Receives codes only; defaults to console.error. */
  log?: (...args: unknown[]) => void;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORBIDDEN = "42501";
function json(data: unknown, status = 200): Response { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }

export async function handleAiPlayground(request: Request, deps: AiPlaygroundDeps): Promise<Response> {
  const log = deps.log ?? console.error;
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  try {
    let input: Record<string, unknown>;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readLimitedBody(request, 65536))); }
    catch (error) { return error instanceof BodyTooLarge ? json({ error: "body_too_large" }, 413) : json({ error: "invalid_input" }, 400); }
    if (!input || typeof input !== "object" || typeof input.organizationId !== "string" || !uuid.test(input.organizationId)) return json({ error: "invalid_input" }, 400);
    const orgId = input.organizationId;
    if (input.action === "status") {
      if (!await deps.authorize(request, orgId, "viewer")) return json({ error: "forbidden" }, 403);
      return json({ configured: deps.configured });
    }
    if (input.action !== "test") return json({ error: "invalid_action" }, 400);
    if (!await deps.authorize(request, orgId, "admin")) return json({ error: "forbidden" }, 403);
    const parsed = playgroundInputSchema.safeParse({ messages: input.messages });
    if (!parsed.success) return json({ error: "invalid_input" }, 400);
    if (!deps.configured) return json({ error: "not_configured" });
    const context = await deps.prepare(orgId);
    if (!context) return json({ error: "forbidden" }, 403);
    if (!await deps.consumeTest(orgId)) return json({ error: "quota_exceeded" });
    try {
      const result = await runReplyPipeline(
        { agent: context.agent, company: context.company, contact: { name: "Contato de teste", tags: [], stage: null, leadScore: null }, stages: context.stages, conversation: parsed.data.messages.map((m) => ({ role: m.role, text: m.text })), channelType: "simulator" },
        { provider: deps.provider, chatModel: deps.chatModel, searchKnowledge: (embedding) => deps.searchKnowledge(orgId, embedding) },
      );
      const decision = result.decision.handoff
        ? { handoff: true, reason: result.decision.reason, label: HANDOFF_LABELS[result.decision.reason], ...(result.decision.detail ? { detail: result.decision.detail } : {}) }
        : { handoff: false };
      return json({ reply: result.reply, classification: result.classification, hits: result.hits, usedChunkIds: result.usedChunkIds, factCheck: result.factCheck, decision });
    } catch (error) {
      log("ai-playground", "pipeline_failed", error instanceof AIProviderError ? error.code : "error");
      return json({ error: "ai_failure" });
    }
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === FORBIDDEN) return json({ error: "forbidden" }, 403);
    log("ai-playground", "operation_failed", typeof code === "string" ? code : "error");
    return json({ error: "operation_failed" }, 503);
  }
}
