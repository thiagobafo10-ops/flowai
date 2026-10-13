import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "admin",
  rpcs: [] as unknown[][],
  rpcError: null as null | { code: string },
  deleted: [{ id: "x" }] as unknown[],
  doc: { id: "d", title: "T", content: "C" } as unknown,
  invocations: [] as unknown[][],
  invokeResult: { data: { configured: true }, error: null } as { data: unknown; error: unknown },
  updates: [] as unknown[][],
  updated: [{ id: "a" }] as unknown[],
}));
vi.mock("@/lib/org/active-org", () => ({ getActiveOrg: async () => ({ id: "org", role: state.role }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u" } } }),
      getSession: async () => ({ data: { session: { access_token: "jwt" } } }),
    },
    rpc: async (...args: unknown[]) => {
      state.rpcs.push(args);
      return state.rpcError ? { data: null, error: state.rpcError } : { data: "00000000-0000-4000-8000-000000000009", error: null };
    },
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.doc, error: null }) }) }) }),
      update: (values: unknown) => ({
        eq: (...a: unknown[]) => ({
          select: async () => { state.updates.push([values, a]); return { data: state.updated, error: null }; },
        }),
      }),
      delete: () => ({
        eq: () => ({ eq: () => ({ select: async () => ({ data: state.deleted, error: null }) }) }),
      }),
    }),
    functions: { invoke: async (...args: unknown[]) => { state.invocations.push(args); return state.invokeResult; } },
  }),
}));
import { getKnowledgeDocument, saveKnowledgeDocument, reprocessKnowledgeDocument, deleteKnowledgeDocument, getAiStatus, saveAgent, runPlayground } from "./actions";

const ID = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  state.role = "admin"; state.rpcs = []; state.rpcError = null; state.deleted = [{ id: "x" }]; state.invocations = []; state.doc = { id: "d", title: "T", content: "C" };
  state.invokeResult = { data: { configured: true }, error: null };
  state.updates = []; state.updated = [{ id: "a" }];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

test("agent não grava documentos", async () => {
  state.role = "agent";
  expect(await saveKnowledgeDocument({ title: "t", content: "c" })).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  expect(await reprocessKnowledgeDocument(ID)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  expect(await deleteKnowledgeDocument(ID)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  expect(state.rpcs).toHaveLength(0);
});
test("título vazio devolve erro de campo", async () => {
  const r = await saveKnowledgeDocument({ title: "  ", content: "c" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.fieldErrors?.title?.[0]).toBe("Informe o título.");
  expect(state.rpcs).toHaveLength(0);
});
test("salva chamando a RPC com a organização e devolve o id", async () => {
  const r = await saveKnowledgeDocument({ id: ID, title: " Doc ", content: "texto" });
  expect(r).toEqual({ ok: true, data: { id: "00000000-0000-4000-8000-000000000009" } });
  expect(state.rpcs[0]).toEqual(["save_knowledge_document", { p_org: "org", p_id: ID, p_title: "Doc", p_content: "texto" }]);
});
test("RPC 42501 vira mensagem de permissão; P0002 vira documento removido", async () => {
  state.rpcError = { code: "42501" };
  expect(await saveKnowledgeDocument({ title: "t", content: "c" })).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  state.rpcError = { code: "P0002" };
  expect(await saveKnowledgeDocument({ id: ID, title: "t", content: "c" })).toEqual({ ok: false, error: "Este documento não existe mais." });
});
test("reprocessa por RPC", async () => {
  expect(await reprocessKnowledgeDocument(ID)).toEqual({ ok: true, data: undefined });
  expect(state.rpcs[0]).toEqual(["reprocess_knowledge_document", { p_id: ID }]);
  state.rpcError = { code: "42501" };
  expect(await reprocessKnowledgeDocument(ID)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
});
test("exclusão sem linhas afetadas indica documento inexistente", async () => {
  expect(await deleteKnowledgeDocument(ID)).toEqual({ ok: true, data: undefined });
  state.deleted = [];
  expect(await deleteKnowledgeDocument(ID)).toEqual({ ok: false, error: "Este documento não existe mais." });
  expect(await deleteKnowledgeDocument("nope")).toEqual({ ok: false, error: "Documento inválido." });
});
test("status da IA usa o JWT da sessão e qualquer papel", async () => {
  state.role = "viewer";
  expect(await getAiStatus()).toEqual({ ok: true, data: { configured: true } });
  expect(state.invocations[0]).toEqual(["ai-playground", { body: { organizationId: "org", action: "status" }, headers: { Authorization: "Bearer jwt" } }]);
  state.invokeResult = { data: null, error: new Error("x") };
  expect((await getAiStatus()).ok).toBe(false);
});

test("criação envia p_id nulo à RPC", async () => {
  await saveKnowledgeDocument({ title: "t", content: "c" });
  expect(state.rpcs[0]).toEqual(["save_knowledge_document", { p_org: "org", p_id: null, p_title: "t", p_content: "c" }]);
});
test("getKnowledgeDocument: sucesso, inexistente e sem permissão", async () => {
  expect(await getKnowledgeDocument(ID)).toEqual({ ok: true, data: { id: "d", title: "T", content: "C" } });
  state.doc = null;
  expect(await getKnowledgeDocument(ID)).toEqual({ ok: false, error: "Este documento não existe mais." });
  expect(await getKnowledgeDocument("nope")).toEqual({ ok: false, error: "Documento inválido." });
  state.role = "agent";
  expect(await getKnowledgeDocument(ID)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
});

const AGENT = { name: "Ana", personality: "p", objective: "o", tone: "cordial", systemPrompt: "x", isActive: true, autoReply: false, humanHandoff: true };
const MSGS = [{ role: "contact" as const, text: "oi" }];

test("saveAgent: agent recebe mensagem de permissão e nada é gravado", async () => {
  state.role = "agent";
  expect(await saveAgent(AGENT)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  expect(state.updates).toHaveLength(0);
});
test("saveAgent: systemPrompt de 8001 caracteres devolve erro de campo", async () => {
  const r = await saveAgent({ ...AGENT, systemPrompt: "a".repeat(8001) });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.fieldErrors?.systemPrompt?.[0]).toBe("O prompt deve ter no máximo 8000 caracteres.");
  expect(state.updates).toHaveLength(0);
});
test("saveAgent: atualiza só colunas com grant, filtrando pela organização", async () => {
  expect(await saveAgent(AGENT)).toEqual({ ok: true, data: undefined });
  expect(state.updates[0]).toEqual([
    { name: "Ana", personality: "p", objective: "o", tone: "cordial", system_prompt: "x", is_active: true, auto_reply: false, human_handoff: true },
    ["organization_id", "org"],
  ]);
  state.updated = [];
  expect((await saveAgent(AGENT)).ok).toBe(false);
});
test("runPlayground: 11 mensagens falha sem chamar a função", async () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? ("ai" as const) : ("contact" as const), text: "m" }));
  const r = await runPlayground(many);
  expect(r.ok).toBe(false);
  expect(state.invocations).toHaveLength(0);
});
test("runPlayground: só admin/owner", async () => {
  state.role = "agent";
  expect(await runPlayground(MSGS)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  expect(state.invocations).toHaveLength(0);
});
test("runPlayground: sucesso e mapeamento de erros", async () => {
  const ok = { reply: "r", classification: null, hits: [], usedChunkIds: [], factCheck: { ok: true, unverified: [] }, decision: { handoff: false } };
  state.invokeResult = { data: ok, error: null };
  expect(await runPlayground(MSGS)).toEqual({ ok: true, data: ok });
  expect(state.invocations[0]).toEqual(["ai-playground", { body: { organizationId: "org", action: "test", messages: MSGS }, headers: { Authorization: "Bearer jwt" } }]);
  const cases: Record<string, string> = {
    quota_exceeded: "Limite diário de testes atingido.",
    not_configured: "IA não configurada na plataforma.",
    ai_failure: "A IA não respondeu. Tente novamente.",
    agent_not_configured: "Agente de IA não encontrado para esta organização.",
    invalid_input: "Mensagens inválidas para o teste.",
  };
  for (const [code, msg] of Object.entries(cases)) {
    state.invokeResult = { data: { error: code }, error: null };
    expect(await runPlayground(MSGS)).toEqual({ ok: false, error: msg });
  }
  state.invokeResult = { data: null, error: new Error("x") };
  expect((await runPlayground(MSGS)).ok).toBe(false);
});
