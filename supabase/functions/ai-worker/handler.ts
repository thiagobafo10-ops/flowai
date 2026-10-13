import { sendClaimedInstagram, type SendClaim, type SendDeps } from "../send-message/handler.ts";
import { constantTimeTextEqual } from "../_shared/http.ts";
import { AIProviderError, chunkText, runReplyPipeline, type AIProvider, type KnowledgeHit, type PipelineInput } from "../../../packages/core/src/ai/index.ts";

export type AiJob = { jobId: string; kind: "reply" | "index_document"; claimToken: string };
export type PreparedReply =
  | { action: "skip" }
  | { action: "handoff"; reason: string; organizationId: string; intentIds: string[] }
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
  /** Receives ids and codes only; defaults to console.error. */
  log?: (...args: unknown[]) => void;
};

/** Database error carrying the SQLSTATE returned by PostgREST. */
export class DbError extends Error {
  readonly code: string | null;
  constructor(code: string | null) { super("Database operation failed"); this.name = "DbError"; this.code = code; }
}

export const AI_WORKER_CONCURRENCY = 3;
export const AI_WORKER_BUDGET_MS = 100_000;
/** In-flight jobs may take up to ~45 s (2 OpenAI calls + embedding + send); no new batch starts inside this window. */
const IN_FLIGHT_MARGIN_MS = 45_000;
const EMBED_BATCH = 64;
const LOST_CLAIM = "42501";
const INVALID_RESULT = "22023";

/** The database rejected the result itself: retrying would pay for the same rejected output again. */
class InvalidResultError extends Error {
  constructor() { super("Result rejected by the database"); this.name = "InvalidResultError"; }
}
async function completing<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; } catch (error) {
    if (error instanceof DbError && error.code === INVALID_RESULT) throw new InvalidResultError();
    throw error;
  }
}

/** Logs ids and codes only; never message or document text. */
function log(deps: AiWorkerDeps, event: string, fields: Record<string, string | number | null>): void { (deps.log ?? console.error)("ai-worker", event, JSON.stringify(fields)); }
function isLostClaim(error: unknown): boolean { return error instanceof DbError && error.code === LOST_CLAIM; }

/** The organization must be known: sendClaimedInstagram checks it against the connection. Without it nothing is claimed. */
async function sendIntents(intentIds: string[], organizationId: string | null | undefined, deps: AiWorkerDeps): Promise<void> {
  if (!organizationId) { if (intentIds.length) log(deps, "missing_organization", { count: intentIds.length }); return; }
  for (const intentId of intentIds) {
    try {
      const claim = await deps.claimSend(intentId);
      if (!claim) continue;
      await sendClaimedInstagram(claim, organizationId, deps);
    } catch { log(deps, "send_failed", { intentId }); }
  }
}

async function processReply(job: AiJob, deps: AiWorkerDeps, org: { id: string | null }): Promise<void> {
  const prepared = await deps.prepareReply(job.jobId, job.claimToken);
  if (prepared.action === "skip") return;
  if (prepared.action === "handoff") { await sendIntents(prepared.intentIds, prepared.organizationId, deps); return; }
  org.id = prepared.organizationId;
  const result = await runReplyPipeline(
    { agent: prepared.agent, company: prepared.company, contact: prepared.contact, stages: prepared.stages, conversation: prepared.conversation, channelType: prepared.channelType },
    { provider: deps.provider, chatModel: deps.chatModel, searchKnowledge: (embedding) => deps.searchKnowledge(prepared.organizationId, embedding) },
  );
  const classification = result.classification ? { ...result.classification, model: deps.chatModel } : null;
  const payload = result.decision.handoff
    ? { classification, reply: null, handoff: { reason: result.decision.reason, detail: result.decision.detail ?? null }, lastMessageId: prepared.lastMessageId }
    : { classification, reply: { text: result.reply, usedChunkIds: result.usedChunkIds, factCheck: result.factCheck }, handoff: null, lastMessageId: prepared.lastMessageId };
  const completed = await completing(deps.completeReply(job.jobId, job.claimToken, payload));
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
  await completing(deps.completeIndex(job.jobId, job.claimToken, chunks.map((chunk, i) => ({ index: chunk.index, content: chunk.content, tokenCount: chunk.tokenCount, embedding: embeddings[i] }))));
}

async function handleFailure(job: AiJob, error: unknown, org: { id: string | null }, deps: AiWorkerDeps): Promise<void> {
  if (isLostClaim(error)) { log(deps, "claim_lost", { jobId: job.jobId, code: LOST_CLAIM }); return; }
  try {
    if (error instanceof AIProviderError) {
      log(deps, "provider_error", { jobId: job.jobId, kind: job.kind, code: error.code });
      if (error.code === "not_configured" && job.kind === "reply") {
        const handoff = await deps.handoffJob(job.jobId, job.claimToken, "not_configured");
        await sendIntents(handoff.intentIds, org.id, deps);
      } else await deps.failJob(job.jobId, job.claimToken, error.code, error.retryable);
    } else if (error instanceof InvalidResultError) {
      log(deps, "invalid_result", { jobId: job.jobId, kind: job.kind, code: INVALID_RESULT });
      await deps.failJob(job.jobId, job.claimToken, "invalid_result", false);
    } else {
      log(deps, "worker_error", { jobId: job.jobId, kind: job.kind });
      await deps.failJob(job.jobId, job.claimToken, "worker_error", true);
    }
  } catch (inner) {
    log(deps, "failure_not_recorded", { jobId: job.jobId, code: inner instanceof DbError ? inner.code : null });
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
  const deadline = deps.now().getTime() + (deps.deadlineMs ?? AI_WORKER_BUDGET_MS) - IN_FLIGHT_MARGIN_MS;
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
