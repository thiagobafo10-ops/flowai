import { DbError, handleAutomationWorker, type AutomationWorkerDeps, type PreparedRun, type AutomationStep } from "../automation-worker/handler.ts";
import { sendClaimedInstagram } from "../send-message/handler.ts";
import { createOpenAIProvider } from "../_shared/openai.ts";
import { createFakeOpenAIFetch } from "./fake-openai.ts";
import type { AutomationGraph } from "../../../packages/core/src/automation/index.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
const MESSAGE = "SEGREDO-DA-MENSAGEM-12345";
const CHUNK = "11111111-1111-4111-8111-111111111111";
const node = (id: string, type: AutomationGraph["nodes"][number]["type"], config: unknown = {}) => ({ id, type, config, position: { x: 0, y: 0 } });
const edge = (source: string, target: string, sourceHandle = "default") => ({ id: `${source}-${target}-${sourceHandle}`, source, target, sourceHandle });
const textNode = (id = "m") => node(id, "message", { mode: "text", text: MESSAGE });
const choice = () => node("m", "message", { mode: "text", text: MESSAGE, quickReplies: [{ id: "a1", title: "Sim" }], replyTimeoutHours: 24 });
const graph = (nodes = [node("t", "trigger"), textNode(), node("e", "end")], edges = [edge("t", "m"), edge("m", "e")]): AutomationGraph => ({ nodes, edges });
const request = (secret = "worker-secret") => new Request("http://x/automation-worker", { method: "POST", headers: { "x-flowai-worker": secret } });

function fixture(overrides: Partial<Extract<PreparedRun, { action: "run" }>> = {}, opts: { hits?: boolean; apiKey?: string } = {}) {
  const steps: AutomationStep[] = [], failures: { code: string; retryable: boolean }[] = [], sends: Record<string, unknown>[] = [], logs: string[] = [], payloadNodes: string[] = [], yields: string[] = [];
  const prepared: Extract<PreparedRun, { action: "run" }> = {
    action: "run", runId: "run", organizationId: "org", conversationId: "conv", channelType: "instagram", currentNodeId: "m", input: null, waitingFor: null, stepCount: 0, iteration: 2, version: 1, graph: graph(),
    context: { contact: { name: "Maria Silva", tagIds: [], stageId: null, leadScore: null }, lastInboundText: "Qual o horario?", lastIntent: null, now: "2026-10-13T12:00:00Z", timezone: "America/Sao_Paulo", channelType: "instagram" },
    ai: { agent: { name: "Ana", personality: "simpatica", objective: "atender", tone: "cordial", systemPrompt: "" }, company: "Loja Teste", contact: { name: "Cli", tags: [], stage: null, leadScore: null }, stages: ["Novo"], conversation: [{ role: "contact", text: "Qual o horario?" }], quotaLeft: true },
    ...overrides,
  };
  let claimed = false, prepares = 0;
  const openai = createFakeOpenAIFetch();
  const deps: AutomationWorkerDeps = {
    readWorkerSecret: async () => "worker-secret",
    claimRuns: async (limit) => { assert(limit === 3); if (claimed) return []; claimed = true; return [{ runId: "run", claimToken: "token" }]; },
    prepareRun: async () => { prepares++; return prepared; },
    buttonPayloads: async (_run, _token, id) => { payloadNodes.push(id); return { a1: "signed-a1" }; },
    applyStep: async (run, token, step) => {
      assert(run === "run" && token === "token"); steps.push(step);
      if (!prepared.waitingFor) prepared.stepCount++;
      prepared.waitingFor = null; prepared.input = null;
      const currentNodeId = "next" in step.route ? step.route.next : step.nodeId;
      prepared.currentNodeId = currentNodeId;
      return { state: "waitReply" in step.route || "waitDelay" in step.route ? "waiting" : "end" in step.route ? "completed" : "running", intentIds: step.effects.some((e) => e.type === "send_text") || step.aiReply ? ["intent"] : [], payloads: {}, result: null, currentNodeId };
    },
    failRun: async (_run, _token, code, retryable) => { failures.push({ code, retryable }); },
    yieldRun: async (run, token) => { yields.push(`${run}/${token}`); },
    searchKnowledge: async () => opts.hits === false ? [] : [{ id: CHUNK, documentTitle: "Horarios", content: "O horario de funcionamento e das 9h as 18h. Fechamos aos domingos.", similarity: 0.9 }],
    provider: createOpenAIProvider({ apiKey: opts.apiKey ?? "key", fetch: openai }), chatModel: "test-model",
    claimSend: async (id) => ({ intentId: id, connectionId: "conn", channelId: "channel", kind: "direct", text: MESSAGE, messagePayload: steps.flatMap((s) => s.effects).find((e) => e.type === "send_text")?.instagram, recipientExternalId: "900", commentId: null, claimToken: "send-token" }),
    readConnectionSecrets: async () => ({ connectionId: "conn", organizationId: "org", appId: "123", apiVersion: "v26.0", generation: 1, disconnected: false, appSecret: "app", verifyToken: "verify", channels: [{ channelId: "channel", accountId: "789", accessToken: "token", status: "active" }] }),
    complete: async (_id, result) => { assert(result.state === "sent"); },
    fetch: async (_url, init) => { sends.push(JSON.parse(String(init?.body))); return Response.json({ message_id: "out", recipient_id: "900" }); },
    resolve: async () => ["93.184.215.14"], now: () => new Date("2026-10-13T12:00:00Z"), log: (...args) => { logs.push(args.join(" ")); },
  };
  return { deps, prepared, steps, failures, sends, logs, payloadNodes, openai, yields, prepares: () => prepares };
}

Deno.test("message flow applies text and end, sends intent and keeps iteration", async () => {
  const f = fixture(); const response = await handleAutomationWorker(request(), f.deps);
  assert(response.status === 200 && (await response.json()).processed === 1);
  assert(f.steps.length === 2 && f.steps[0].nodeId === "m" && f.steps[1].nodeId === "e");
  assert(f.steps[0].iteration === 2 && "next" in f.steps[0].route && f.steps[0].route.next === "e");
  assert(f.sends.length === 1 && (f.sends[0].message as any).text === MESSAGE && f.failures.length === 0);
});
Deno.test("quick replies fetch signed payloads and send full Instagram body before waiting", async () => {
  const f = fixture({ graph: graph([node("t", "trigger"), choice(), node("e", "end")], [edge("t", "m"), edge("m", "e", "opt:a1"), edge("m", "e", "no_reply")]) });
  await handleAutomationWorker(request(), f.deps);
  assert(f.steps.length === 1 && f.payloadNodes.join() === "m");
  assert((f.sends[0].message as any).quick_replies[0].payload === "signed-a1");
});
for (const [label, input, handle] of [
  ["click", { optionId: "a1", text: null }, "opt:a1"], ["typed title", { optionId: null, text: "sim" }, "opt:a1"],
  ["timeout", null, "no_reply"], ["unmatched text", { optionId: null, text: "outro" }, "no_reply"],
] as const) {
  Deno.test(`resume ${label} closes wait node without resend and follows resolved exit`, async () => {
    const f = fixture({ graph: graph([node("t", "trigger"), choice(), textNode("yes"), node("e", "end")], [edge("t", "m"), edge("m", "yes", "opt:a1"), edge("m", "e", "no_reply"), edge("yes", "e")]), waitingFor: "reply", input });
    await handleAutomationWorker(request(), f.deps);
    assert(f.steps[0]?.nodeId === "m" && f.steps[0].handle === handle && f.steps[0].effects.length === 0);
    assert("next" in f.steps[0].route && f.steps[0].route.next === (handle === "opt:a1" ? "yes" : "e"));
    assert(f.steps[1].nodeId === (handle === "opt:a1" ? "yes" : "e"));
    assert(f.sends.length === (handle === "opt:a1" ? 1 : 0));
  });
}
Deno.test("condition selects false exit", async () => {
  const f = fixture({ currentNodeId: "c", graph: graph([node("t", "trigger"), node("c", "condition", { kind: "lead_score_gte", value: 50 }), textNode(), node("e", "end")], [edge("t", "c"), edge("c", "m", "true"), edge("c", "e", "false"), edge("m", "e")]) });
  await handleAutomationWorker(request(), f.deps);
  assert(f.steps[0]?.handle === "false" && f.steps[1].nodeId === "e" && f.sends.length === 0);
});
for (const input of [null, { optionId: null, text: "Obrigado" }]) {
  Deno.test(`plain first comment reply resumes default to CRM without resend (${input ? "reply" : "timeout"})`, async () => {
    const f = fixture({ waitingFor: "reply", input, graph: graph([node("t", "trigger"), textNode(), node("tag", "tag", { tagId: CHUNK }), node("e", "end")], [edge("t", "m"), edge("m", "tag"), edge("tag", "e")]) });
    await handleAutomationWorker(request(), f.deps);
    assert(f.steps[0]?.handle === "default" && f.steps[0].effects.length === 0);
    assert(f.steps[1]?.nodeId === "tag" && f.steps[1].effects[0]?.type === "add_tag");
    assert(f.sends.length === 0 && f.failures.length === 0);
  });
}
Deno.test("delay parks after apply and resumes through default without another delay", async () => {
  const g = graph([node("t", "trigger"), node("d", "delay", { minutes: 10 }), node("e", "end")], [edge("t", "d"), edge("d", "e")]);
  const f = fixture({ currentNodeId: "d", graph: g }); await handleAutomationWorker(request(), f.deps);
  assert(f.steps.length === 1 && "waitDelay" in f.steps[0].route && f.steps[0].route.waitDelay.until === "2026-10-13T12:10:00.000Z");
  const r = fixture({ currentNodeId: "d", graph: g, waitingFor: "delay" }); await handleAutomationWorker(request(), r.deps);
  assert(r.steps.length === 2 && r.steps[0].handle === "default" && r.steps[1].nodeId === "e");
});
for (const [label, url, status, failCode, retryable] of [
  ["ok", "https://example.test/hook", 204, null, false], ["blocked", "https://127.0.0.1/", 200, "webhook_blocked_address", false], ["retryable", "https://example.test/hook", 503, "webhook_http_error", true],
] as const) {
  Deno.test(`webhook ${label} executes before applying or fails with a safe code`, async () => {
    const f = fixture({ currentNodeId: "w", graph: graph([node("t", "trigger"), node("w", "webhook", { url }), node("e", "end")], [edge("t", "w"), edge("w", "e")]) });
    let fetched = 0; f.deps.fetch = async () => { assert(f.steps.length === 0); fetched++; return new Response(null, { status }); };
    await handleAutomationWorker(request(), f.deps);
    if (failCode) assert(f.steps.length === 0 && f.failures[0]?.code === failCode && f.failures[0].retryable === retryable);
    else assert(f.steps.length === 2 && f.steps[0].handle === "default" && fetched === 1);
    if (label === "blocked") assert(fetched === 0);
  });
}
Deno.test("webhook body carries iteration and an Idempotency-Key per run/node/iteration", async () => {
  const f = fixture({ currentNodeId: "w", graph: graph([node("t", "trigger"), node("w", "webhook", { url: "https://example.test/hook" }), node("e", "end")], [edge("t", "w"), edge("w", "e")]) });
  let body: Record<string, unknown> = {}; let key: string | null = null;
  f.deps.fetch = async (_url, init) => { body = JSON.parse(String(init?.body)); key = new Headers(init?.headers).get("idempotency-key"); return new Response(null, { status: 204 }); };
  await handleAutomationWorker(request(), f.deps);
  assert(body.runId === "run" && body.nodeId === "w" && body.iteration === 2, JSON.stringify(body));
  assert(key === "run:w:2", String(key));
});
for (const code of ["40P01", "40001"]) {
  Deno.test(`SQLSTATE ${code} (deadlock/serialization) fails retryably`, async () => {
    const f = fixture(); f.deps.applyStep = async () => { throw new DbError(code); };
    await handleAutomationWorker(request(), f.deps);
    assert(f.failures[0]?.code === "db_conflict" && f.failures[0].retryable === true, JSON.stringify(f.failures));
  });
}
Deno.test("Instagram button template over 640 characters fails with a fixed code before applying", async () => {
  const f = fixture({ graph: graph([node("t", "trigger"), node("m", "message", { mode: "text", text: "a".repeat(641), buttons: [{ id: "a1", title: "Sim", kind: "path" }], replyTimeoutHours: 24 }), node("e", "end")], [edge("t", "m"), edge("m", "e", "opt:a1"), edge("m", "e", "no_reply")]) });
  await handleAutomationWorker(request(), f.deps);
  assert(f.steps.length === 0 && f.sends.length === 0 && f.failures[0]?.code === "invalid_content" && !f.failures[0].retryable, JSON.stringify(f.failures));
});
function aiGraph() { return graph([node("t", "trigger"), node("m", "message", { mode: "ai" }), node("h", "handoff_human"), node("e", "end")], [edge("t", "m"), edge("m", "e", "sent"), edge("m", "h", "handoff")]); }
Deno.test("AI sent passes aiReply with knowledge ids", async () => {
  const f = fixture({ graph: aiGraph() }); await handleAutomationWorker(request(), f.deps);
  assert(f.steps[0]?.handle === "sent" && f.steps[0].aiReply?.text === "O horario de funcionamento e das 9h as 18h.");
  assert(f.steps[0].aiReply.usedChunkIds[0] === CHUNK && f.sends.length === 1);
});
for (const mode of ["no_knowledge", "not_configured"] as const) {
  Deno.test(`AI ${mode} routes handoff without reply`, async () => {
    const f = fixture({ graph: aiGraph() }, mode === "no_knowledge" ? { hits: false } : { apiKey: "" });
    await handleAutomationWorker(request(), f.deps);
    assert(f.steps[0]?.handle === "handoff" && !f.steps[0].aiReply && f.steps[1].nodeId === "h" && f.sends.length === 0 && f.failures.length === 0);
  });
}
Deno.test("worker refreshes context and AI data after CRM steps", async () => {
  const f = fixture({ currentNodeId: "t", graph: aiGraph() });
  const prepare = f.deps.prepareRun; f.deps.prepareRun = async (...args) => { const p = await prepare(...args); if (p.action === "run" && p.currentNodeId === "t") return { ...p, ai: undefined }; return p; };
  await handleAutomationWorker(request(), f.deps);
  assert(f.prepares() >= 2 && f.steps[1]?.handle === "sent");
});
Deno.test("database reroute currentNodeId wins over local route", async () => {
  const f = fixture({ graph: aiGraph() }); const apply = f.deps.applyStep;
  f.deps.applyStep = async (...args) => { const result = await apply(...args); if (args[2].nodeId === "m") { f.prepared.currentNodeId = "h"; return { ...result, currentNodeId: "h", result: "quota_exceeded" }; } return result; };
  await handleAutomationWorker(request(), f.deps); assert(f.steps[1]?.nodeId === "h");
});
for (const operation of ["prepareRun", "buttonPayloads", "applyStep"] as const) {
  for (const [code, expected] of [["42501", null], ["22023", "invalid_step"]] as const) {
    Deno.test(`${operation} SQLSTATE ${code} obeys lost claim or invalid step contract`, async () => {
      const f = fixture(); f.deps[operation] = async () => { throw new DbError(code); };
      await handleAutomationWorker(request(), f.deps);
      assert(expected ? f.failures[0]?.code === expected && f.failures[0].retryable === false : f.failures.length === 0 && f.logs.some((l) => l.includes("claim_lost")));
      assert(f.sends.length === 0);
    });
  }
}
Deno.test("invalid graph fails nonretryably; prepare skip ends quietly", async () => {
  const f = fixture({ graph: { nodes: [{ type: "bogus" }], edges: [] } }); await handleAutomationWorker(request(), f.deps);
  assert(f.failures[0]?.code === "invalid_graph" && f.failures[0].retryable === false);
  const s = fixture(); s.deps.prepareRun = async () => ({ action: "skip" }); await handleAutomationWorker(request(), s.deps);
  assert(s.steps.length === 0 && s.failures.length === 0 && s.sends.length === 0);
});
Deno.test("run cannot apply over 50 steps in one invocation", async () => {
  const f = fixture({ graph: graph([textNode()], [edge("m", "m")]) }); await handleAutomationWorker(request(), f.deps);
  assert(f.steps.length === 50 && f.failures[0]?.code === "max_steps" && f.failures[0].retryable === false);
});
Deno.test("bad secret returns 401 before claiming, logs contain no text or secrets", async () => {
  const f = fixture(); let claimed = false; f.deps.claimRuns = async () => { claimed = true; return []; };
  assert((await handleAutomationWorker(request("wrong"), f.deps)).status === 401 && !claimed);
  const e = fixture(); e.deps.applyStep = async () => { throw new Error(MESSAGE); }; await handleAutomationWorker(request(), e.deps);
  assert(e.logs.length > 0 && !e.logs.join().includes(MESSAGE) && !e.logs.join().includes("worker-secret"));
});
Deno.test("sendClaimedInstagram forwards claim messagePayload instead of discarding quick replies", async () => {
  const f = fixture(); const payload = { text: "Escolha", quick_replies: [{ content_type: "text", title: "Sim", payload: "signed-a1" }] };
  await sendClaimedInstagram({ intentId: "intent", connectionId: "conn", channelId: "channel", kind: "direct", text: "Escolha", messagePayload: payload, recipientExternalId: "900", commentId: null, claimToken: "token" }, "org", f.deps);
  assert(JSON.stringify(f.sends[0].message) === JSON.stringify(payload));
});
Deno.test("private reply claims forward stored button template with comment recipient", async () => {
  const f = fixture();
  const payload = { attachment: { type: "template", payload: { template_type: "button", text: "Quer seu guia?", buttons: [{ type: "postback", title: "Quero", payload: "signed-a1" }] } } };
  const result = await sendClaimedInstagram({ intentId: "intent", connectionId: "conn", channelId: "channel", kind: "private_reply", text: "Fallback", messagePayload: payload, recipientExternalId: "900", commentId: "c1", claimToken: "token" }, "org", f.deps);
  assert(JSON.stringify(f.sends[0].message) === JSON.stringify(payload) && (f.sends[0].recipient as any).comment_id === "c1");
  assert(result.state === "sent" && result.recipientId === "900");
});
Deno.test("oversized Instagram text reaches DB blocker so run completes reply_too_long", async () => {
  const f = fixture({ graph: graph([textNode(), node("e", "end")], [edge("m", "e")]) });
  (f.prepared.graph as AutomationGraph).nodes[0].config = { mode: "text", text: "é".repeat(600) };
  f.deps.applyStep = async (_run, _token, step) => { f.steps.push(step); return { state: "completed", intentIds: [], payloads: {}, result: "reply_too_long", currentNodeId: "m" }; };
  await handleAutomationWorker(request(), f.deps);
  assert(f.steps.length === 1 && f.steps[0].effects[0].type === "send_text" && f.failures.length === 0 && f.sends.length === 0);
});
Deno.test("invocation budget stops before next effect without failing or interrupting apply", async () => {
  const f = fixture({ graph: graph([textNode(), textNode("m2"), node("e", "end")], [edge("m", "m2"), edge("m2", "e")]) });
  let clock = new Date("2026-10-13T12:00:00Z"); f.deps.now = () => clock;
  const apply = f.deps.applyStep;
  f.deps.applyStep = async (...args) => { const result = await apply(...args); clock = new Date("2026-10-13T12:01:41Z"); return result; };
  await handleAutomationWorker(request(), f.deps);
  assert(f.steps.length === 1 && f.sends.length === 1 && f.failures.length === 0 && f.yields.join() === "run/token");
  assert(f.prepared.currentNodeId === "m2");
});
for (const mode of ["quota_exhausted", "no_agent"] as const) {
  Deno.test(`AI ${mode} routes handoff without paid provider calls`, async () => {
    const f = fixture({ graph: aiGraph() }); assert(f.prepared.ai);
    if (mode === "quota_exhausted") f.prepared.ai.quotaLeft = false;
    else f.prepared.ai.agent = null;
    await handleAutomationWorker(request(), f.deps);
    assert(f.steps[0]?.handle === "handoff" && !f.steps[0].aiReply && f.steps[1].nodeId === "h" && f.failures.length === 0 && f.openai.calls.length === 0);
  });
}
for (const mode of ["webhook", "ai"] as const) {
  for (const startingCount of [49, 50]) {
    Deno.test(`persisted count ${startingCount} blocks new ${mode} effects beyond 50`, async () => {
      const w = node("w", "webhook", { url: "https://example.test/hook" });
      const a = node("a", "message", { mode: "ai" });
      const f = fixture({ currentNodeId: "w", stepCount: startingCount, graph: graph([w, a, node("e", "end")], [edge("w", "a"), edge("a", "e", "sent")]) });
      if (mode === "ai") f.prepared.currentNodeId = "a";
      let hooks = 0;
      const transport = f.deps.fetch; f.deps.fetch = async (url, init) => { if (String(url).includes("example.test")) { hooks++; return new Response(null, { status: 204 }); } return transport(url, init); };
      await handleAutomationWorker(request(), f.deps);
      assert(f.failures[0]?.code === "max_steps" && !f.failures[0].retryable);
      assert(f.steps.length === (startingCount === 49 ? 1 : 0));
      assert(hooks === (mode === "webhook" && startingCount === 49 ? 1 : 0));
      assert(f.openai.calls.length === (mode === "ai" && startingCount === 49 ? 3 : 0));
    });
  }
}
Deno.test("effect-free wait resume remains allowed at persisted count 50", async () => {
  const f = fixture({ stepCount: 50, waitingFor: "reply", input: { optionId: "a1", text: null }, graph: graph([choice(), node("e", "end")], [edge("m", "e", "opt:a1")]) });
  await handleAutomationWorker(request(), f.deps);
  assert(f.steps.length === 1 && f.steps[0].handle === "opt:a1" && f.steps[0].effects.length === 0);
  assert(f.failures[0]?.code === "max_steps" && f.sends.length === 0 && f.openai.calls.length === 0);
});
Deno.test("lost claim during budget yield does not fail or retry run", async () => {
  const f = fixture(); let clock = new Date("2026-10-13T12:00:00Z"); f.deps.now = () => clock;
  const prepare = f.deps.prepareRun; f.deps.prepareRun = async (...args) => { const p = await prepare(...args); clock = new Date("2026-10-13T12:01:41Z"); return p; };
  f.deps.yieldRun = async () => { throw new DbError("42501"); };
  await handleAutomationWorker(request(), f.deps);
  assert(f.steps.length === 0 && f.failures.length === 0 && f.logs.some((l) => l.includes("claim_lost")));
});
