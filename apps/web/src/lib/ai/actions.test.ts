import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "admin",
  rpcs: [] as unknown[][],
  rpcError: null as null | { code: string },
  deleted: [{ id: "x" }] as unknown[],
  invocations: [] as unknown[][],
  invokeResult: { data: { configured: true }, error: null } as { data: unknown; error: unknown },
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
      delete: () => ({
        eq: () => ({ eq: () => ({ select: async () => ({ data: state.deleted, error: null }) }) }),
      }),
    }),
    functions: { invoke: async (...args: unknown[]) => { state.invocations.push(args); return state.invokeResult; } },
  }),
}));
import { saveKnowledgeDocument, reprocessKnowledgeDocument, deleteKnowledgeDocument, getAiStatus } from "./actions";

const ID = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  state.role = "admin"; state.rpcs = []; state.rpcError = null; state.deleted = [{ id: "x" }]; state.invocations = [];
  state.invokeResult = { data: { configured: true }, error: null };
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
