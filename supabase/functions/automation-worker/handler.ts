import { automationGraphSchema, executeNode, MAX_STEPS, nextNode, resolveReply, toInstagramMessage, type AutomationGraph, type Effect, type RunContext } from "../../../packages/core/src/automation/index.ts";
import { AIProviderError, runReplyPipeline, type AIProvider, type KnowledgeHit, type PipelineInput } from "../../../packages/core/src/ai/index.ts";
import { sendClaimedInstagram, type SendClaim, type SendDeps } from "../send-message/handler.ts";
import { postSafeWebhook, type Resolver } from "../_shared/safe-webhook.ts";
import { constantTimeTextEqual } from "../_shared/http.ts";

export type RunClaim = { runId: string; claimToken: string };
export type PreparedRun = { action: "skip" } | {
  action: "run"; runId: string; organizationId: string; conversationId: string | null;
  channelType: "simulator" | "instagram" | null; currentNodeId: string;
  input: { optionId: string | null; text: string | null } | null; waitingFor: "reply" | "delay" | null;
  stepCount: number; iteration: number; version: number; graph: unknown; context: RunContext;
  ai?: Pick<PipelineInput, "company" | "contact" | "stages" | "conversation"> & { agent: PipelineInput["agent"] | null; quotaLeft: boolean };
};
export type AutomationEffect = Effect & { instagram?: Record<string, unknown> };
export type AutomationStep = {
  nodeId: string; iteration: number; handle: string | null; effects: AutomationEffect[];
  route: { next: string } | { end: true } | { waitReply: { until: string } } | { waitDelay: { until: string } };
  aiReply?: { text: string; usedChunkIds: string[] };
};
export type AppliedStep = { state: string; intentIds: string[]; payloads: Record<string, string>; result: string | null; currentNodeId: string };
export type AutomationWorkerDeps = SendDeps & {
  readWorkerSecret(): Promise<string | null>;
  claimRuns(limit: number): Promise<RunClaim[]>;
  prepareRun(run: string, token: string): Promise<PreparedRun>;
  buttonPayloads(run: string, token: string, node: string): Promise<Record<string, string>>;
  applyStep(run: string, token: string, step: AutomationStep): Promise<AppliedStep>;
  failRun(run: string, token: string, code: string, retryable: boolean): Promise<void>;
  yieldRun(run: string, token: string): Promise<void>;
  claimSend(intent: string): Promise<SendClaim | null>;
  searchKnowledge(org: string, embedding: number[]): Promise<KnowledgeHit[]>;
  provider: AIProvider; chatModel: string; resolve?: Resolver; deadlineMs?: number;
  log?: (...args: unknown[]) => void;
};
export class DbError extends Error {
  constructor(readonly code: string | null) { super("Database operation failed"); this.name = "DbError"; }
}

const CONCURRENCY = 3;
const BUDGET_MS = 100_000;
// Leave room for a pipeline plus a send before starting another batch.
const IN_FLIGHT_MARGIN_MS = 45_000;

class RunError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super("Automation operation failed"); }
}

function log(deps: AutomationWorkerDeps, event: string, fields: Record<string, string | number | null>): void {
  (deps.log ?? console.error)("automation-worker", event, JSON.stringify(fields));
}
function routeFor(graph: AutomationGraph, nodeId: string, handle: string): AutomationStep["route"] {
  const next = nextNode(graph, nodeId, handle);
  return next ? { next } : { end: true };
}

async function sendIntents(intentIds: string[], organizationId: string, deps: AutomationWorkerDeps): Promise<void> {
  for (const intentId of intentIds) {
    try {
      const claim = await deps.claimSend(intentId);
      if (claim) await sendClaimedInstagram(claim, organizationId, deps);
    } catch { log(deps, "send_failed", { intentId }); }
  }
}

async function buildStep(run: RunClaim, prepared: Extract<PreparedRun, { action: "run" }>, graph: AutomationGraph, nodeId: string, deps: AutomationWorkerDeps): Promise<AutomationStep> {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new RunError("invalid_graph");
  if (prepared.waitingFor) {
    // Comment private replies always wait, including plain text/URL-only messages.
    const config = node.config as { mode?: string; buttons?: { kind: string }[]; quickReplies?: unknown[] };
    const plainMessage = node.type === "message" && config.mode === "text"
      && !config.buttons?.some((b) => b.kind === "path") && !config.quickReplies?.length;
    const handle = prepared.waitingFor === "delay" || plainMessage ? "default" : prepared.input ? resolveReply(node, { optionId: prepared.input.optionId ?? null, text: prepared.input.text ?? null }) : "no_reply";
    return { nodeId, iteration: prepared.iteration, handle, effects: [], route: routeFor(graph, nodeId, handle) };
  }

  const outcome = executeNode(graph, nodeId, prepared.context);
  const step: AutomationStep = { nodeId, iteration: prepared.iteration, handle: null, effects: outcome.effects, route: { end: true } };
  for (const effect of step.effects) {
    if (effect.type === "send_text" && prepared.channelType === "instagram") {
      // The database records reply_too_long and completes the run without sending.
      // Do not let the transport formatter turn that documented result into a failure.
      if (new TextEncoder().encode(effect.text).byteLength <= 1000) {
        const payloads = await deps.buttonPayloads(run.runId, run.claimToken, nodeId);
        effect.instagram = toInstagramMessage(effect.text, { buttons: effect.buttons, quickReplies: effect.quickReplies, payloads });
      }
    } else if (effect.type === "webhook") {
      const result = await postSafeWebhook(effect.url, { runId: run.runId, nodeId, organizationId: prepared.organizationId, context: prepared.context }, { fetch: deps.fetch, resolve: deps.resolve });
      if (!result.ok) throw new RunError(`webhook_${result.code}`, result.retryable);
      step.handle = "default";
    } else if (effect.type === "ai_message") {
      step.handle = "handoff";
      if (prepared.ai?.agent && prepared.channelType && prepared.ai.quotaLeft) {
        try {
          const result = await runReplyPipeline({ ...prepared.ai, agent: prepared.ai.agent, channelType: prepared.channelType }, {
            provider: deps.provider, chatModel: deps.chatModel, searchKnowledge: (embedding) => deps.searchKnowledge(prepared.organizationId, embedding),
          });
          if (!result.decision.handoff && result.reply) {
            step.handle = "sent";
            step.aiReply = { text: result.reply, usedChunkIds: result.usedChunkIds };
          }
        } catch (error) {
          if (!(error instanceof AIProviderError && error.code === "not_configured")) throw error;
        }
      }
    }
  }
  if ("handle" in outcome.route) step.handle = outcome.route.handle;
  if ("waitReply" in outcome.route || "waitDelay" in outcome.route) step.route = outcome.route;
  else if ("end" in outcome.route) step.route = { end: true };
  else {
    if (!step.handle) throw new RunError("invalid_step");
    step.route = routeFor(graph, nodeId, step.handle);
  }
  return step;
}

async function processRun(run: RunClaim, deps: AutomationWorkerDeps, deadline: number): Promise<void> {
  try {
    let currentNodeId: string | null = null;
    for (let count = 0; count < MAX_STEPS; count++) {
      // Yield only between persisted steps, releasing the claim without spending
      // an error attempt. Never interrupt an external effect before its apply.
      if (deps.now().getTime() >= deadline) { await deps.yieldRun(run.runId, run.claimToken); log(deps, "budget_reached", { runId: run.runId }); return; }
      // Refresh CRM state and fetch AI context for the current node, including after a resume.
      const prepared = await deps.prepareRun(run.runId, run.claimToken);
      if (prepared.action === "skip") return;
      const parsed = automationGraphSchema.safeParse(prepared.graph);
      if (!parsed.success) throw new RunError("invalid_graph");
      currentNodeId ??= prepared.currentNodeId;
      if (deps.now().getTime() >= deadline) { await deps.yieldRun(run.runId, run.claimToken); log(deps, "budget_reached", { runId: run.runId }); return; }
      // The persisted run limit applies before network effects, across claims.
      // A wait resume only closes an existing step and is still allowed at 50.
      if (!prepared.waitingFor && prepared.stepCount >= MAX_STEPS) throw new RunError("max_steps");
      const step = await buildStep(run, prepared, parsed.data, currentNodeId, deps);
      const applied = await deps.applyStep(run.runId, run.claimToken, step);
      await sendIntents(applied.intentIds, prepared.organizationId, deps);
      if (applied.state !== "running") return;
      // DB may redirect AI sent to handoff (quota/length blocker).
      currentNodeId = applied.currentNodeId;
    }
    throw new RunError("max_steps");
  } catch (error) {
    if (error instanceof DbError && error.code === "42501") {
      log(deps, "claim_lost", { runId: run.runId, code: error.code }); return;
    }
    const code = error instanceof DbError && error.code === "22023" ? "invalid_step" : error instanceof RunError || error instanceof AIProviderError ? error.code : "worker_error";
    const retryable = error instanceof RunError || error instanceof AIProviderError ? error.retryable : false;
    log(deps, "run_failed", { runId: run.runId, code });
    try { await deps.failRun(run.runId, run.claimToken, code, retryable); }
    catch (inner) { log(deps, "failure_not_recorded", { runId: run.runId, code: inner instanceof DbError ? inner.code : null }); }
  }
}

export async function handleAutomationWorker(request: Request, deps: AutomationWorkerDeps): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  try {
    const secret = await deps.readWorkerSecret();
    const provided = request.headers.get("x-flowai-worker") ?? "";
    if (!secret || !provided || provided.length > 8192 || !await constantTimeTextEqual(provided, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const deadline = deps.now().getTime() + (deps.deadlineMs ?? BUDGET_MS);
    let processed = 0;
    while (deps.now().getTime() < deadline - IN_FLIGHT_MARGIN_MS) {
      const batch = await deps.claimRuns(CONCURRENCY);
      if (!batch.length) break;
      await Promise.all(batch.map((run) => processRun(run, deps, deadline)));
      processed += batch.length;
    }
    return Response.json({ processed });
  } catch { return Response.json({ error: "temporarily_unavailable" }, { status: 503 }); }
}
