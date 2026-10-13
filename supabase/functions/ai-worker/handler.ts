import { sendClaimedInstagram, type SendClaim, type SendDeps } from "../send-message/handler.ts";
import { constantTimeTextEqual } from "../_shared/http.ts";
import { AIProviderError, chunkText, runReplyPipeline, type AIProvider, type KnowledgeHit, type PipelineInput } from "../../../packages/core/src/ai/index.ts";

export type AiJob = { jobId: string; kind: "reply" | "index_document"; claimToken: string };
export type PreparedReply =
  | { action: "skip" }
  | { action: "handoff"; reason: string; intentIds: string[] }
  | ({ action: "run"; organizationId: string; conversationId: string; channelType: "simulator" | "instagram"; lastMessageId: string } & Pick<PipelineInput, "agent" | "company" | "contact" | "stages" | "conversation">);
export type PreparedIndex = { documentId: string; organizationId: string; generation: number; title: string; content: string };
export type IndexChunk = { index: number; content: string; tokenCount: number; embedding: number[] };

export type AiWorkerDeps = SendDeps & {
  readWorkerSecret(): Promise<string | null>;
  claimJobs(limit: number): Promise<AiJob[]>;
  prepareReply(jobId: string, token: string): Promise<PreparedReply>;
  completeReply(jobId: string, token: string, result: unknown): Promise<{ state: string; intentIds: string[] }>;
  handoffJob(jobId: string, token: string, reason: string): Promise<{ intentIds: string[] }>;
  prepareIndex(jobId: string, token: string): Promise<PreparedIndex | null>;
  completeIndex(jobId: string, token: string, chunks: IndexChunk[]): Promise<"done" | "stale">;
  failJob(jobId: string, token: string, code: string, retryable: boolean): Promise<void>;
  searchKnowledge(orgId: string, embedding: number[]): Promise<KnowledgeHit[]>;
  claimSend(intentId: string): Promise<SendClaim | null>;
  provider: AIProvider;
  chatModel: string;
  deadlineMs?: number;
};

/** Database error carrying the SQLSTATE returned by PostgREST. */
export class DbError extends Error {
  readonly code: string | null;
  constructor(code: string | null) { super("Database operation failed"); this.name = "DbError"; this.code = code; }
}

export const AI_WORKER_CONCURRENCY = 3;
export const AI_WORKER_BUDGET_MS = 100_000;
const EMBED_BATCH = 64;
const LOST_CLAIM = "42501";

/** Logs ids and codes only; never message or document text. */
function log(event: string, fields: Record<string, string | number | null>): void { console.error("ai-worker", event, JSON.stringify(fields)); }
function isLostClaim(error: unknown): boolean { return error instanceof DbError && error.code === LOST_CLAIM; }

/** organizationId is null when the DB handoff result does not carry it; the claimed connection's own org is used then (the claim itself is already authorized by the service-only RPC). */
async function sendIntents(intentIds: string[], organizationId: string | null, deps: AiWorkerDeps): Promise<void> {
  for (const intentId of intentIds) {
    try {
      const claim = await deps.claimSend(intentId);
      if (!claim) continue;
      const orgId = organizationId ?? (await deps.readConnectionSecrets(claim.connectionId))?.organizationId ?? "";
      await sendClaimedInstagram(claim, orgId, deps);
    } catch { log("send_failed", { intentId }); }
  }
}

async function processReply(job: AiJob, deps: AiWorkerDeps, org: { id: string | null }): Promise<void> {
  const prepared = await deps.prepareReply(job.jobId, job.claimToken);
  if (prepared.action === "skip") return;
  if (prepared.action === "handoff") { await sendIntents(prepared.intentIds, org.id, deps); return; }
  org.id = prepared.organizationId;
  const result = await runReplyPipeline(
    { agent: prepared.agent, company: prepared.company, contact: prepared.contact, stages: prepared.stages, conversation: prepared.conversation, channelType: prepared.channelType },
    { provider: deps.provider, chatModel: deps.chatModel, searchKnowledge: (embedding) => deps.searchKnowledge(prepared.organizationId, embedding) },
  );
  const classification = result.classification ? { ...result.classification, model: deps.chatModel } : null;
  const payload = result.decision.handoff
    ? { classification, reply: null, handoff: { reason: result.decision.reason, detail: result.decision.detail ?? null }, lastMessageId: prepared.lastMessageId }
    : { classification, reply: { text: result.reply, usedChunkIds: result.usedChunkIds, factCheck: result.factCheck }, handoff: null, lastMessageId: prepared.lastMessageId };
  const completed = await deps.completeReply(job.jobId, job.claimToken, payload);
  await sendIntents(completed.intentIds, prepared.organizationId, deps);
}

async function processIndex(job: AiJob, deps: AiWorkerDeps): Promise<void> {
  const prepared = await deps.prepareIndex(job.jobId, job.claimToken);
  if (!prepared) return;
  const chunks = chunkText(prepared.content);
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await deps.provider.embed(batch.map((chunk) => chunk.content));
    if (vectors.length !== batch.length) throw new AIProviderError("invalid_response");
    embeddings.push(...vectors);
  }
  await deps.completeIndex(job.jobId, job.claimToken, chunks.map((chunk, i) => ({ index: chunk.index, content: chunk.content, tokenCount: chunk.tokenCount, embedding: embeddings[i] })));
}

async function handleFailure(job: AiJob, error: unknown, org: { id: string | null }, deps: AiWorkerDeps): Promise<void> {
  if (isLostClaim(error)) { log("claim_lost", { jobId: job.jobId, code: LOST_CLAIM }); return; }
  try {
    if (error instanceof AIProviderError) {
      log("provider_error", { jobId: job.jobId, kind: job.kind, code: error.code });
      if (error.code === "not_configured" && job.kind === "reply") {
        const handoff = await deps.handoffJob(job.jobId, job.claimToken, "not_configured");
        await sendIntents(handoff.intentIds, org.id, deps);
      } else await deps.failJob(job.jobId, job.claimToken, error.code, error.retryable);
    } else {
      log("worker_error", { jobId: job.jobId, kind: job.kind });
      await deps.failJob(job.jobId, job.claimToken, "worker_error", true);
    }
  } catch (inner) {
    log("failure_not_recorded", { jobId: job.jobId, code: inner instanceof DbError ? inner.code : null });
  }
}

export async function processAiJob(job: AiJob, deps: AiWorkerDeps): Promise<void> {
  const org: { id: string | null } = { id: null };
  try {
    if (job.kind === "reply") await processReply(job, deps, org);
    else await processIndex(job, deps);
  } catch (error) { await handleFailure(job, error, org, deps); }
}

export async function drainAiJobs(deps: AiWorkerDeps): Promise<number> {
  const deadline = deps.now().getTime() + (deps.deadlineMs ?? AI_WORKER_BUDGET_MS);
  let processed = 0;
  while (deps.now().getTime() < deadline) {
    const batch = await deps.claimJobs(AI_WORKER_CONCURRENCY);
    if (batch.length === 0) break;
    await Promise.all(batch.map((job) => processAiJob(job, deps)));
    processed += batch.length;
  }
  return processed;
}

export async function handleAiWorker(request: Request, deps: AiWorkerDeps): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  try {
    const secret = await deps.readWorkerSecret();
    const provided = request.headers.get("x-flowai-worker") ?? "";
    if (!secret || !provided || provided.length > 8192 || !await constantTimeTextEqual(provided, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json({ processed: await drainAiJobs(deps) });
  } catch { return Response.json({ error: "temporarily_unavailable" }, { status: 503 }); }
}
