import { beforeEach, expect, test, vi } from "vitest";

type Call = { table: string; columns: string; filters: [string, unknown][] };
const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  calls: [] as { table: string; columns: string; filters: [string, unknown][] }[],
  rpcs: [] as [string, unknown][],
  results: null as unknown,
  error: null as null | { code: string },
  rpcError: null as null | { code: string },
}));

function fakeClient() {
  return {
    rpc: async (name: string, args: unknown) => {
      state.rpcs.push([name, args]);
      return { data: state.results, error: state.rpcError };
    },
    from: (table: string) => {
      const call: Call = { table, columns: "", filters: [] };
      state.calls.push(call);
      const b: Record<string, unknown> = {};
      b.select = (columns: string) => { call.columns = columns; return b; };
      b.order = () => b;
      b.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return b; };
      b.maybeSingle = async () => ({ data: (state.tables[table] ?? [])[0] ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: state.tables[table] ?? [], error: state.error });
      return b;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => fakeClient() }));
import { listAutomations, loadAutomation, loadEditorRefs, loadGraphRefs } from "./queries";

beforeEach(() => {
  state.tables = {};
  state.calls = [];
  state.rpcs = [];
  state.results = null;
  state.error = null;
  state.rpcError = null;
});

test("listAutomations filtra pela organização, usa a janela de 7 dias e mapeia as contagens", async () => {
  state.tables.automations = [
    { id: "a1", name: "Um", trigger_type: "message_received", status: "active", updated_at: "2026-10-12T00:00:00Z", mcp_spec: null },
    { id: "a2", name: "Dois", trigger_type: "keyword_detected", status: "draft", updated_at: "2026-10-11T00:00:00Z", mcp_spec: { nome: "Dois" } },
  ];
  state.results = [{ automationId: "a1", runs: 5, uniqueContacts: 3, clicks: { total: 2, byButton: [] } }];
  const now = new Date("2026-10-13T12:00:00.000Z");
  const rows = await listAutomations("org-1", now);
  expect(state.calls[0]).toEqual({
    table: "automations",
    columns: "id, name, trigger_type, status, updated_at, mcp_spec",
    filters: [["organization_id", "org-1"]],
  });
  expect(state.rpcs).toEqual([["automation_results", { p_org: "org-1", p_from: "2026-10-06T12:00:00.000Z", p_to: "2026-10-13T12:00:00.000Z" }]]);
  expect(rows).toEqual([
    { id: "a1", name: "Um", triggerType: "message_received", status: "active", runs7d: 5, clicks7d: 2, contacts7d: 3, createdByClaude: false, updatedAt: "2026-10-12T00:00:00Z" },
    { id: "a2", name: "Dois", triggerType: "keyword_detected", status: "draft", runs7d: 0, clicks7d: 0, contacts7d: 0, createdByClaude: true, updatedAt: "2026-10-11T00:00:00Z" },
  ]);
});

test("listAutomations assume zero com payload inesperado ou automação sem resultados", async () => {
  state.tables.automations = [
    { id: "a1", name: "Um", trigger_type: "comment", status: "draft", updated_at: "2026-10-12T00:00:00Z", mcp_spec: null },
  ];
  state.results = [{ automationId: "outra", runs: 9, uniqueContacts: 9, clicks: { total: 9 } }, null, "x"];

  expect((await listAutomations("org-1"))[0]).toMatchObject({ runs7d: 0, clicks7d: 0, contacts7d: 0 });

  state.results = { not: "an array" };
  expect((await listAutomations("org-1"))[0]).toMatchObject({ runs7d: 0, clicks7d: 0, contacts7d: 0 });

  state.results = [{ automationId: "a1", runs: -3, uniqueContacts: true, clicks: { total: -1 } }];
  expect((await listAutomations("org-1"))[0]).toMatchObject({ runs7d: 0, clicks7d: 0, contacts7d: 0 });
});

test("listAutomations falha em vez de apresentar números zerados quando a lista não pode ser lida", async () => {
  state.error = { code: "42501" };
  await expect(listAutomations("org-1")).rejects.toEqual({ code: "42501" });
});

test("listAutomations falha em vez de apresentar números zerados quando o RPC de resultados falha", async () => {
  state.rpcError = { code: "22023" };
  await expect(listAutomations("org-1")).rejects.toEqual({ code: "22023" });
});

test("loadGraphRefs escopa pela organização e escolhe os padrões dos modelos", async () => {
  state.tables = {
    tags: [{ id: "t1" }, { id: "t2" }],
    pipelines: [{ id: "p1" }],
    memberships: [{ user_id: "u1" }, { user_id: "u2" }],
    channels: [{ id: "c1" }, { id: "c2" }],
    sequences: [{ id: "seq1" }],
    entry_links: [{ id: "link1" }],
    pipeline_stages: [
      { id: "s-won", is_won: true, is_lost: false },
      { id: "s-lost", is_won: false, is_lost: true },
      { id: "s-open", is_won: false, is_lost: false },
    ],
  };
  const { refs, defaults } = await loadGraphRefs(fakeClient() as never, "org-1");
  expect(refs).toEqual({ tagIds: ["t1", "t2"], stageIds: ["s-won", "s-lost", "s-open"], userIds: ["u1", "u2"], channelIds: ["c1", "c2"], sequenceIds: ["seq1"], entryLinkIds: ["link1"] });
  expect(defaults).toEqual({ channelId: "c1", tagId: "t1", tagId2: "t2", stageId: "s-open" });
  for (const call of state.calls) expect(call.filters).toContainEqual(["organization_id", "org-1"]);
  expect(state.calls.find((c) => c.table === "channels")!.filters).toContainEqual(["type", "instagram"]);
  expect(state.calls.find((c) => c.table === "pipelines")!.filters).toContainEqual(["is_default", true]);
  expect(state.calls.find((c) => c.table === "pipeline_stages")!.filters).toContainEqual(["pipeline_id", "p1"]);
});

test("loadGraphRefs sem pipeline ou canal devolve padrões nulos", async () => {
  const { refs, defaults } = await loadGraphRefs(fakeClient() as never, "org-1");
  expect(refs).toEqual({ tagIds: [], stageIds: [], userIds: [], channelIds: [], sequenceIds: [], entryLinkIds: [] });
  expect(defaults).toEqual({ channelId: null, tagId: null, tagId2: null, stageId: null });
});

test("loadEditorRefs devolve nomes para os seletores do editor, escopados pela organização", async () => {
  state.tables = {
    tags: [{ id: "t1", name: "Lead" }],
    pipelines: [{ id: "p1" }],
    pipeline_stages: [{ id: "s1", name: "Novo" }],
    memberships: [{ user_id: "u1", profiles: { full_name: " Ana " } }, { user_id: "u2", profiles: null }],
    channels: [{ id: "c1", name: "Loja", type: "instagram" }],
    entry_links: [{ id: "l1", name: "Promoção" }],
    sequences: [{ id: "seq1", name: "Boas-vindas" }],
  };
  const refs = await loadEditorRefs(fakeClient() as never, "org-1");
  expect(refs).toEqual({
    tags: [{ id: "t1", name: "Lead" }],
    stages: [{ id: "s1", name: "Novo" }],
    members: [{ id: "u1", name: "Ana" }, { id: "u2", name: "Sem nome" }],
    channels: [{ id: "c1", name: "Loja", type: "instagram" }],
    entryLinks: [{ id: "l1", name: "Promoção" }],
    sequences: [{ id: "seq1", name: "Boas-vindas" }],
  });
  for (const call of state.calls) expect(call.filters).toContainEqual(["organization_id", "org-1"]);
  expect(state.calls.find((c) => c.table === "pipelines")!.filters).toContainEqual(["is_default", true]);
  expect(state.calls.find((c) => c.table === "pipeline_stages")!.filters).toContainEqual(["pipeline_id", "p1"]);
});

test("loadAutomation inclui a versão atual", async () => {
  state.tables = {
    automations: [{ id: "a1", name: "Um", status: "draft", trigger_type: "contact_created", trigger_config: {}, current_version: 3 }],
    automation_nodes: [{ id: "n1", type: "trigger", config: {}, position: { x: 1, y: 2 } }],
    automation_edges: [],
  };
  const a = await loadAutomation(fakeClient() as never, "org-1", "a1");
  expect(a).toMatchObject({ id: "a1", currentVersion: 3, graph: { nodes: [{ id: "n1", position: { x: 1, y: 2 } }], edges: [] } });
});
