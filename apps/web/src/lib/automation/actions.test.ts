import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TEMPLATE_PLACEHOLDER, automationTemplates } from "@flowai/core";

const state = vi.hoisted(() => ({
  role: "admin",
  rpcs: [] as unknown[][],
  rpcError: null as null | { code: string; message?: string },
  tables: {} as Record<string, unknown[]>,
}));
vi.mock("@/lib/org/active-org", () => ({ getActiveOrg: async () => ({ id: "org", role: state.role }) }));
vi.mock("@/lib/supabase/server", () => {
  function builder(table: string) {
    const rows = () => state.tables[table] ?? [];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "order"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null });
    return b;
  }
  return {
    createServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "u" } } }) },
      rpc: async (...args: unknown[]) => {
        state.rpcs.push(args);
        return state.rpcError ? { data: null, error: state.rpcError } : { data: "00000000-0000-4000-8000-000000000009", error: null };
      },
      from: (table: string) => builder(table),
    }),
  };
});
import {
  activateAutomation, createAutomation, deleteAutomation, duplicateAutomation, pauseAutomation,
  rerunFrom, saveAutomation, stopAutomation,
} from "./actions";

type Args = {
  p_name: string; p_trigger_type: string; p_trigger_config: { channelId?: string };
  p_graph: { nodes: { id: string; type?: string }[]; edges: { id: string }[] };
};
const ID = "00000000-0000-4000-8000-000000000001";
const NODE = "00000000-0000-4000-8000-0000000000d1";
const FORBIDDEN = { ok: false, error: "Você não tem permissão para esta ação." };
const EMPTY_GRAPH = { nodes: [], edges: [] };
const END = "00000000-0000-4000-8000-0000000000d2";
const VALID_GRAPH = {
  nodes: [
    { id: NODE, type: "trigger", config: {}, position: { x: 0, y: 0 } },
    { id: END, type: "end", config: {}, position: { x: 0, y: 100 } },
  ],
  edges: [{ id: "00000000-0000-4000-8000-0000000000e1", source_node_id: NODE, target_node_id: END, source_handle: "default" }],
};

function seedAutomation(status: string, graph: { nodes: unknown[]; edges?: unknown[] }) {
  state.tables.automations = [{ id: ID, name: "A", status, trigger_type: "message_received", trigger_config: { firstMessageOnly: false } }];
  state.tables.automation_nodes = graph.nodes;
  state.tables.automation_edges = graph.edges ?? [];
}

beforeEach(() => {
  state.role = "admin"; state.rpcs = []; state.rpcError = null;
  state.tables = {
    channels: [{ id: "00000000-0000-4000-8000-0000000000c9" }],
    tags: [{ id: "00000000-0000-4000-8000-0000000000a9" }],
    pipelines: [{ id: "p" }],
    pipeline_stages: [
      { id: "00000000-0000-4000-8000-0000000000b8", is_won: true, is_lost: false },
      { id: "00000000-0000-4000-8000-0000000000b9", is_won: false, is_lost: false },
    ],
    memberships: [{ user_id: "u" }],
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

test("agent não cria nem altera automações", async () => {
  state.role = "agent";
  expect(await createAutomation({})).toEqual(FORBIDDEN);
  expect(await activateAutomation(ID)).toEqual(FORBIDDEN);
  expect(await pauseAutomation(ID)).toEqual(FORBIDDEN);
  expect(await duplicateAutomation(ID)).toEqual(FORBIDDEN);
  expect(await deleteAutomation(ID)).toEqual(FORBIDDEN);
  expect(await rerunFrom(ID, NODE)).toEqual(FORBIDDEN);
  expect(state.rpcs).toHaveLength(0);
});

test("em branco cria só o gatilho message_received", async () => {
  const r = await createAutomation({ name: " Minha " });
  expect(r).toEqual({ ok: true, data: { id: "00000000-0000-4000-8000-000000000009" } });
  const [fn, args] = state.rpcs[0] as [string, Args];
  expect(fn).toBe("save_automation");
  expect(args).toMatchObject({ p_org: "org", p_id: null, p_name: "Minha", p_trigger_type: "message_received" });
  expect(args.p_graph.nodes).toHaveLength(1);
  expect(args.p_graph.nodes[0]).toMatchObject({ type: "trigger" });
  expect(args.p_graph.edges).toEqual([]);
});

test("modelo envia o grafo do modelo com ids novos e referências reais", async () => {
  const template = automationTemplates.find((t) => t.key === "qualify_buttons")!;
  await createAutomation({ templateKey: "qualify_buttons" });
  const [, args] = state.rpcs[0] as [string, Args];
  expect(args.p_name).toBe(template.name);
  expect(args.p_trigger_type).toBe(template.triggerType);
  expect(args.p_graph.nodes).toHaveLength(template.graph.nodes.length);
  expect(args.p_graph.edges).toHaveLength(template.graph.edges.length);
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const x of [...args.p_graph.nodes, ...args.p_graph.edges]) expect(x.id).toMatch(uuidV4);
  const json = JSON.stringify(args.p_graph);
  expect(json).toContain("00000000-0000-4000-8000-0000000000a9");
  expect(json).toContain("00000000-0000-4000-8000-0000000000b9");
  expect(json).not.toContain(TEMPLATE_PLACEHOLDER.tagId);
  expect(json).not.toContain(TEMPLATE_PLACEHOLDER.stageId);
  // dois usos do mesmo modelo não compartilham ids
  await createAutomation({ templateKey: "qualify_buttons" });
  const second = (state.rpcs[1] as [string, Args])[1];
  expect(second.p_graph.nodes[0].id).not.toBe(args.p_graph.nodes[0].id);
});

test("modelo do Instagram usa o primeiro canal e mantém o espaço reservado sem canal", async () => {
  await createAutomation({ templateKey: "comment_link" });
  const [, a] = state.rpcs[0] as [string, Args];
  expect(a.p_trigger_config.channelId).toBe("00000000-0000-4000-8000-0000000000c9");
  state.tables.channels = [];
  await createAutomation({ templateKey: "comment_link" });
  const [, b] = state.rpcs[1] as [string, Args];
  expect(b.p_trigger_config.channelId).toBe(TEMPLATE_PLACEHOLDER.channelId);
});

test("ativar com problemas devolve-os e não chama a RPC", async () => {
  seedAutomation("draft", EMPTY_GRAPH);
  const r = await activateAutomation(ID);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.issues.length).toBeGreaterThan(0);
  expect(state.rpcs).toHaveLength(0);
});

test("ativar uma automação válida chama a RPC", async () => {
  seedAutomation("draft", VALID_GRAPH);
  const r = await activateAutomation(ID);
  expect(r).toEqual({ ok: true, data: { issues: [] } });
  expect(state.rpcs[0]).toEqual(["activate_automation", { p_id: ID }]);
});

test("salvar automação ativa com problemas é recusado com a mensagem exata", async () => {
  seedAutomation("active", EMPTY_GRAPH);
  const r = await saveAutomation({ id: ID, name: "A", triggerType: "message_received", triggerConfig: { firstMessageOnly: false }, graph: EMPTY_GRAPH });
  expect(r).toEqual({ ok: false, error: "Corrija os erros antes de salvar uma automação ativa." });
  expect(state.rpcs).toHaveLength(0);
});

test("rascunho com problemas é salvo e devolve os problemas", async () => {
  seedAutomation("draft", EMPTY_GRAPH);
  const r = await saveAutomation({ id: ID, name: "A", triggerType: "message_received", triggerConfig: { firstMessageOnly: false }, graph: EMPTY_GRAPH });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.data.issues.length).toBeGreaterThan(0);
  expect(state.rpcs[0]![0]).toBe("save_automation");
});

test("RPC 42501 vira permissão, P0002 vira inexistente", async () => {
  state.rpcError = { code: "42501" };
  expect(await pauseAutomation(ID)).toEqual(FORBIDDEN);
  expect(await createAutomation({})).toEqual(FORBIDDEN);
  state.rpcError = { code: "P0002" };
  expect(await deleteAutomation(ID)).toEqual({ ok: false, error: "Esta automação não existe mais." });
});

test("pausar, duplicar e excluir chamam as RPCs", async () => {
  expect(await pauseAutomation(ID)).toEqual({ ok: true, data: undefined });
  expect(await duplicateAutomation(ID)).toEqual({ ok: true, data: { id: "00000000-0000-4000-8000-000000000009" } });
  expect(await deleteAutomation(ID)).toEqual({ ok: true, data: undefined });
  expect(state.rpcs.map((c) => c[0])).toEqual(["pause_automation", "duplicate_automation", "delete_automation"]);
  expect(await deleteAutomation("nope")).toEqual({ ok: false, error: "Automação inválida." });
});

test("reexecutar: conversation_busy tem mensagem própria", async () => {
  expect(await rerunFrom(ID, NODE)).toEqual({ ok: true, data: undefined });
  expect(state.rpcs[0]).toEqual(["rerun_automation_from", { p_run: ID, p_node: NODE }]);
  state.rpcError = { code: "22023", message: "conversation_busy" };
  expect(await rerunFrom(ID, NODE)).toEqual({ ok: false, error: "A conversa já tem outra automação em andamento." });
  state.rpcError = { code: "22023", message: "run_not_rerunnable" };
  expect(await rerunFrom(ID, NODE)).toEqual({ ok: false, error: "Não foi possível reexecutar a partir deste passo." });
});

test("parar automação vale para agent e bloqueia viewer", async () => {
  state.role = "agent";
  expect(await stopAutomation(ID)).toEqual({ ok: true, data: undefined });
  expect(state.rpcs[0]).toEqual(["stop_automation", { p_conversation: ID }]);
  state.role = "viewer";
  expect(await stopAutomation(ID)).toEqual(FORBIDDEN);
});
