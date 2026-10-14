import { beforeEach, expect, test, vi } from "vitest";

type Call = { table: string; filters: [string, unknown][] };
const state = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  calls: [] as { table: string; filters: [string, unknown][] }[],
  rpcs: [] as [string, unknown][],
  counts: [] as { automation_id: string; runs: number }[],
}));

function fakeClient() {
  return {
    rpc: async (name: string, args: unknown) => {
      state.rpcs.push([name, args]);
      return { data: state.counts, error: null };
    },
    from: (table: string) => {
      const call: Call = { table, filters: [] };
      state.calls.push(call);
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.eq = (column: string, value: unknown) => { call.filters.push([column, value]); return b; };
      b.maybeSingle = async () => ({ data: (state.tables[table] ?? [])[0] ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: state.tables[table] ?? [], error: null });
      return b;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => fakeClient() }));
import { listAutomations, loadAutomation, loadEditorRefs, loadGraphRefs } from "./queries";

beforeEach(() => { state.tables = {}; state.calls = []; state.rpcs = []; state.counts = []; });

test("listAutomations filtra pela organização, usa a janela de 7 dias e mapeia as contagens", async () => {
  state.tables.automations = [
    { id: "a1", name: "Um", trigger_type: "message_received", status: "active", updated_at: "2026-10-12T00:00:00Z" },
    { id: "a2", name: "Dois", trigger_type: "keyword_detected", status: "draft", updated_at: "2026-10-11T00:00:00Z" },
  ];
  state.counts = [{ automation_id: "a1", runs: 5 }];
  const now = new Date("2026-10-13T12:00:00.000Z");
  const rows = await listAutomations("org-1", now);
  expect(state.calls[0]).toEqual({ table: "automations", filters: [["organization_id", "org-1"]] });
  expect(state.rpcs).toEqual([["automation_run_counts", { p_org: "org-1", p_since: "2026-10-06T12:00:00.000Z" }]]);
  expect(rows).toEqual([
    { id: "a1", name: "Um", triggerType: "message_received", status: "active", runs7d: 5, updatedAt: "2026-10-12T00:00:00Z" },
    { id: "a2", name: "Dois", triggerType: "keyword_detected", status: "draft", runs7d: 0, updatedAt: "2026-10-11T00:00:00Z" },
  ]);
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
  expect(defaults).toEqual({ channelId: "c1", tagId: "t1", stageId: "s-open" });
  for (const call of state.calls) expect(call.filters).toContainEqual(["organization_id", "org-1"]);
  expect(state.calls.find((c) => c.table === "channels")!.filters).toContainEqual(["type", "instagram"]);
  expect(state.calls.find((c) => c.table === "pipelines")!.filters).toContainEqual(["is_default", true]);
  expect(state.calls.find((c) => c.table === "pipeline_stages")!.filters).toContainEqual(["pipeline_id", "p1"]);
});

test("loadGraphRefs sem pipeline ou canal devolve padrões nulos", async () => {
  const { refs, defaults } = await loadGraphRefs(fakeClient() as never, "org-1");
  expect(refs).toEqual({ tagIds: [], stageIds: [], userIds: [], channelIds: [], sequenceIds: [], entryLinkIds: [] });
  expect(defaults).toEqual({ channelId: null, tagId: null, stageId: null });
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
