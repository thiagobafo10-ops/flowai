import { handleAiPlayground, type AiPlaygroundDeps } from "../ai-playground/handler.ts";
import { createOpenAIProvider } from "../_shared/openai.ts";
import { createFakeOpenAIFetch } from "./fake-openai.ts";
function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }

const org = "00000000-0000-4000-8000-000000000001";
const CHUNK_ID = "11111111-1111-4111-8111-111111111111";
const KNOWLEDGE = "O horario de funcionamento e das 9h as 18h. Fechamos aos domingos.";

function fixture(opts: { role?: "admin" | "viewer" | null; hits?: boolean; quota?: boolean; configured?: boolean } = {}) {
  const role = opts.role === undefined ? "admin" : opts.role;
  const calls = { prepare: 0, consume: 0, search: 0 };
  const openai = createFakeOpenAIFetch();
  const deps: AiPlaygroundDeps = {
    authorize: async (_request, _org, minimumRole) => role === null || (minimumRole === "admin" && role !== "admin") ? null : { userId: "user" },
    provider: createOpenAIProvider({ apiKey: "key", fetch: openai }),
    configured: opts.configured ?? true,
    chatModel: "test-model",
    prepare: async () => { calls.prepare++; return { agent: { name: "Ana", personality: "simpatica", objective: "atender", tone: "cordial", systemPrompt: "", humanHandoff: true }, company: "Loja Teste", stages: ["Novo"] }; },
    consumeTest: async () => { calls.consume++; return opts.quota ?? true; },
    searchKnowledge: async () => { calls.search++; return opts.hits === false ? [] : [{ id: CHUNK_ID, documentTitle: "Horarios", content: KNOWLEDGE, similarity: 0.9 }]; },
  };
  const request = (body: Record<string, unknown>, auth: string | null = "Bearer jwt") => new Request("http://x/ai-playground", { method: "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify({ organizationId: org, ...body }) });
  return { deps, calls, openai, request };
}
const test = (text = "Qual o horario?") => ({ action: "test", messages: [{ role: "contact", text }] });

Deno.test("missing Authorization is 401", async () => {
  const f = fixture(); const response = await handleAiPlayground(f.request({ action: "status" }, null), f.deps);
  assert(response.status === 401); assert(response.headers.get("cache-control") === "no-store");
});

Deno.test("non-member is 403", async () => {
  const f = fixture({ role: null });
  const response = await handleAiPlayground(f.request({ action: "status" }), f.deps);
  assert(response.status === 403); assert((await response.json()).error === "forbidden");
});

Deno.test("viewer gets status", async () => {
  const f = fixture({ role: "viewer" });
  const response = await handleAiPlayground(f.request({ action: "status" }), f.deps);
  assert(response.status === 200); assert((await response.json()).configured === true);
  const off = fixture({ role: "viewer", configured: false });
  assert((await (await handleAiPlayground(off.request({ action: "status" }), off.deps)).json()).configured === false);
});

Deno.test("viewer test is 403 without side effects", async () => {
  const f = fixture({ role: "viewer" });
  const response = await handleAiPlayground(f.request(test()), f.deps);
  assert(response.status === 403); assert(f.calls.consume === 0 && f.calls.prepare === 0 && f.openai.calls.length === 0);
});

Deno.test("11 messages is 400 and consumes no quota", async () => {
  const f = fixture();
  const messages = Array.from({ length: 11 }, (_, i) => ({ role: i % 2 === 0 ? "contact" : "ai", text: "oi" }));
  const response = await handleAiPlayground(f.request({ action: "test", messages }), f.deps);
  assert(response.status === 400); assert((await response.json()).error === "invalid_input"); assert(f.calls.consume === 0);
});

Deno.test("exhausted quota skips the provider", async () => {
  const f = fixture({ quota: false });
  const response = await handleAiPlayground(f.request(test()), f.deps);
  assert(response.status === 200); assert((await response.json()).error === "quota_exceeded");
  assert(f.calls.consume === 1 && f.openai.calls.length === 0);
});

Deno.test("not configured does not consume quota", async () => {
  const f = fixture({ configured: false });
  const response = await handleAiPlayground(f.request(test()), f.deps);
  assert(response.status === 200); assert((await response.json()).error === "not_configured");
  assert(f.calls.consume === 0 && f.openai.calls.length === 0);
});

Deno.test("success returns reply, hits and no handoff", async () => {
  const f = fixture();
  const response = await handleAiPlayground(f.request(test()), f.deps);
  assert(response.status === 200);
  const body = await response.json();
  assert(body.reply && body.hits.length === 1 && body.hits[0].id === CHUNK_ID && body.hits[0].documentTitle === "Horarios");
  assert(body.usedChunkIds[0] === CHUNK_ID && body.classification && body.factCheck);
  assert(body.decision.handoff === false); assert(f.calls.consume === 1);
});

Deno.test("question without knowledge hands off with label", async () => {
  const f = fixture({ hits: false });
  const body = await (await handleAiPlayground(f.request(test("Qual o horario?")), f.deps)).json();
  assert(body.decision.handoff === true && body.decision.reason === "no_knowledge");
  assert(body.decision.label === "IA sem informação na base de conhecimento");
});

Deno.test("provider failure is ai_failure", async () => {
  const f = fixture(); f.deps.provider = createOpenAIProvider({ apiKey: "key", fetch: createFakeOpenAIFetch({ onCall: () => ({ status: 500 }) }) });
  const response = await handleAiPlayground(f.request(test()), f.deps);
  assert(response.status === 200); assert((await response.json()).error === "ai_failure");
});

Deno.test("null agent is agent_not_configured without quota or provider", async () => {
  const f = fixture(); f.deps.prepare = async () => { f.calls.prepare++; return { agent: null, company: "x", stages: [] } as never; };
  const response = await handleAiPlayground(f.request(test()), f.deps);
  assert(response.status === 200); assert((await response.json()).error === "agent_not_configured");
  assert(f.calls.consume === 0 && f.openai.calls.length === 0);
});

Deno.test("null company defaults to empty and still runs", async () => {
  const f = fixture(); const base = f.deps.prepare;
  f.deps.prepare = async () => ({ ...(await base("x"))!, company: null as never });
  const response = await handleAiPlayground(f.request(test()), f.deps);
  assert(response.status === 200); assert((await response.json()).decision.handoff === false);
});

Deno.test("pipeline gets the fixed test contact and the simulator channel", async () => {
  const f = fixture(); await handleAiPlayground(f.request(test()), f.deps);
  const system = JSON.stringify(f.openai.calls.filter((c) => c.path === "/chat/completions").map((c) => c.body.messages[0].content));
  assert(system.includes("Nome: Contato de teste") && system.includes("Tags: nenhuma") && system.includes("Etapa atual: nenhuma") && system.includes("Lead score: n/d"));
  assert(system.includes("até 4000 caracteres"));
});

Deno.test("42501 from prepare or consume is 403", async () => {
  const a = fixture(); a.deps.prepare = async () => { throw Object.assign(new Error("x"), { code: "42501" }); };
  assert((await handleAiPlayground(a.request(test()), a.deps)).status === 403);
  const b = fixture(); b.deps.consumeTest = async () => { throw Object.assign(new Error("x"), { code: "42501" }); };
  assert((await handleAiPlayground(b.request(test()), b.deps)).status === 403);
});

Deno.test("prepare null is 403", async () => {
  const f = fixture(); f.deps.prepare = async () => null;
  assert((await handleAiPlayground(f.request(test()), f.deps)).status === 403); assert(f.calls.consume === 0);
});

Deno.test("non-POST is 405", async () => {
  const f = fixture();
  assert((await handleAiPlayground(new Request("http://x/", { method: "GET" }), f.deps)).status === 405);
});

Deno.test("oversized body is 413", async () => {
  const f = fixture();
  const response = await handleAiPlayground(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer jwt" }, body: "x".repeat(70000) }), f.deps);
  assert(response.status === 413);
});

Deno.test("invalid action and invalid organizationId are 400", async () => {
  const f = fixture();
  assert((await handleAiPlayground(f.request({ action: "nope" }), f.deps)).status === 400);
  assert((await handleAiPlayground(f.request({ action: "status", organizationId: "not-a-uuid" }), f.deps)).status === 400);
});

Deno.test("1001-char message is 400", async () => {
  const f = fixture();
  const response = await handleAiPlayground(f.request(test("a".repeat(1001))), f.deps);
  assert(response.status === 400); assert(f.calls.consume === 0);
});

Deno.test("provider failure consumed quota exactly once", async () => {
  const f = fixture(); f.deps.provider = createOpenAIProvider({ apiKey: "key", fetch: createFakeOpenAIFetch({ onCall: () => ({ status: 500 }) }) });
  await handleAiPlayground(f.request(test()), f.deps);
  assert(f.calls.consume === 1);
});
