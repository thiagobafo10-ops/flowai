import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type Row = Record<string, unknown>;
type Query = { table: string; filters: [string, string, unknown][] };

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  memberships: [] as Row[],
  channels: [] as Row[],
  automations: [] as Row[],
  nodes: [] as Row[],
  queries: [] as Query[],
  rpcs: [] as [string, Record<string, unknown>][],
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
  invokes: [] as [string, { body: Record<string, unknown>; headers: Record<string, string> }][],
  invokeResult: { data: null as unknown, error: null as unknown },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: async () =>
        state.user
          ? { data: { user: state.user }, error: null }
          : { data: { user: null }, error: { message: "invalid JWT", status: 401 } },
    },
    from: (table: string) => {
      const query: Query = { table, filters: [] };
      state.queries.push(query);
      const builder = {
        select: () => builder,
        eq: (k: string, v: unknown) => { query.filters.push(["eq", k, v]); return builder; },
        not: (k: string, op: string, v: unknown) => { query.filters.push([`not.${op}`, k, v]); return builder; },
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => unknown) => {
          const rows = table === "memberships" ? state.memberships : table === "channels" ? state.channels : table === "automation_nodes" ? state.nodes : state.automations;
          const filtered = rows.filter((row) =>
            query.filters.every(([op, k, v]) => op !== "eq" || k === "user_id" || row[k] === undefined || row[k] === v),
          );
          return resolve({ data: filtered, error: null });
        },
      };
      return builder;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcs.push([name, args]);
      return state.rpcResults[name] ?? { data: null, error: { code: "XX000", message: "boom" } };
    },
    functions: {
      invoke: async (name: string, options: { body: Record<string, unknown>; headers: Record<string, string> }) => {
        state.invokes.push([name, options]);
        return state.invokeResult;
      },
    },
  }),
}));

import { DELETE, GET, POST } from "@/app/mcp/route";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode(payload)}.signature`;
}

const TOKEN = jwt({ sub: "user-1", role: "authenticated", client_id: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d" });
const AUTOMATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRIGGER_NODE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MESSAGE_NODE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const END_NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const SPEC: Row = {
  nome: "Ebook",
  gatilho: "comentario",
  palavras: ["ebook"],
  post: "qualquer",
  respostaPublica: ["Te mandei no direct!"],
  dm: { texto: "Aqui está o ebook.", botoes: [{ titulo: "Baixar", url: "https://exemplo.com.br/ebook.pdf" }] },
  umaVezPorContato: true,
};

function automationRow(overrides: Row = {}): Row {
  return {
    id: AUTOMATION_ID,
    organization_id: "org-1",
    name: "Ebook",
    status: "active",
    trigger_type: "instagram_comment",
    trigger_config: { channelId: "ch-1", mediaId: null, keywords: ["ebook"], mode: "contains", oncePerUser: true },
    mcp_spec: SPEC,
    mcp_spec_stale: false,
    updated_at: "2026-10-26",
    ...overrides,
  };
}

function nodeRow(id: string, type: string, y: number): Row {
  return { id, organization_id: "org-1", automation_id: AUTOMATION_ID, type, position: { x: 0, y } };
}

function seedNodes(): Row[] {
  return [nodeRow(TRIGGER_NODE, "trigger", 0), nodeRow(MESSAGE_NODE, "message", 160), nodeRow(END_NODE, "end", 320)];
}
const handlers: Record<string, (request: Request) => Promise<Response>> = { POST, GET, DELETE };

let client: Client | null = null;

async function connect(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("https://app.example.com/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    fetch: async (url, init) => {
      const request = new Request(url, init);
      return handlers[request.method](request);
    },
  });
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as { type: string; text: string }[];
  return content.map((c) => c.text).join("\n");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  state.user = { id: "user-1" };
  state.memberships = [{ organization_id: "org-1", role: "owner", created_at: "2026-01-01" }];
  state.channels = [{ id: "ch-1", meta_connection_id: "conn-1", created_at: "2026-01-01" }];
  state.automations = [];
  state.nodes = [];
  state.queries = [];
  state.rpcs = [];
  state.rpcResults = {};
  state.invokes = [];
  state.invokeResult = { data: null, error: null };
});

afterEach(async () => {
  await client?.close();
  client = null;
  vi.useRealTimers();
});

describe("/mcp", () => {
  it("unauthenticated_gets_401", async () => {
    const response = await POST(
      new Request("https://app.example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/mcp"',
    );
    const get = await GET(new Request("https://app.example.com/mcp", { headers: { accept: "text/event-stream" } }));
    expect(get.status).toBe(401);
  });

  it("rejects_body_over_1mb", async () => {
    const response = await POST(
      new Request("https://app.example.com/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { pad: "x".repeat(1024 * 1024) } }),
      }),
    );
    expect(response.status).toBe(413);
  });

  it("lists_tools", async () => {
    const mcp = await connect();
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "listar_posts",
        "listar_automacoes",
        "ver_resultados",
        "listar_contatos",
        "criar_automacao",
        "editar_automacao",
        "pausar_automacao",
        "ativar_automacao",
        "excluir_automacao",
      ]),
    );
    for (const tool of tools) expect(tool.description?.length ?? 0).toBeGreaterThan(40);
  });

  it("listar_posts_maps_media", async () => {
    state.invokeResult = {
      data: {
        media: [
          { id: "1790", caption: "a".repeat(400), mediaType: "VIDEO", mediaUrl: "https://cdn/x.mp4", thumbnailUrl: null, permalink: "https://instagram.com/p/x", timestamp: "2026-10-20T10:00:00+0000" },
          { id: "1791", caption: "segundo", mediaType: "IMAGE", mediaUrl: null, thumbnailUrl: null, permalink: null, timestamp: null },
        ],
      },
      error: null,
    };
    const mcp = await connect();
    const result = await mcp.callTool({ name: "listar_posts", arguments: { limite: 1 } });
    expect(result.isError).toBeFalsy();
    const posts = (result.structuredContent as { posts: Row[] }).posts;
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({
      id: "1790",
      legenda: "a".repeat(300),
      tipo: "VIDEO",
      data: "2026-10-20T10:00:00+0000",
      link: "https://instagram.com/p/x",
    });
    expect(text(result)).toContain("1790");
    expect(state.invokes).toHaveLength(1);
    const [name, options] = state.invokes[0];
    expect(name).toBe("meta-connection");
    expect(options.body).toEqual({ organizationId: "org-1", connectionId: "conn-1", channelId: "ch-1", action: "list_media" });
    expect(options.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("listar_posts_without_channel", async () => {
    state.channels = [];
    const mcp = await connect();
    const result = await mcp.callTool({ name: "listar_posts", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Nenhuma conta do Instagram conectada");
    expect(state.invokes).toHaveLength(0);
  });

  it("listar_posts_maps_edge_errors", async () => {
    state.invokeResult = { data: null, error: { message: "Edge Function returned a non-2xx status code", context: Response.json({ error: "invalid_token" }, { status: 422 }) } };
    const mcp = await connect();
    const result = await mcp.callTool({ name: "listar_posts", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("O token do Instagram é inválido ou expirou.");
  });

  it("listar_posts_maps_forbidden", async () => {
    state.invokeResult = { data: null, error: { message: "Edge Function returned a non-2xx status code", context: Response.json({ error: "forbidden" }, { status: 403 }) } };
    const mcp = await connect();
    const result = await mcp.callTool({ name: "listar_posts", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Só administradores da organização podem listar os posts do Instagram.");
  });

  it("authenticated_get_is_405", async () => {
    const response = await GET(
      new Request("https://app.example.com/mcp", { headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream" } }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("listar_automacoes_maps_rows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
    state.automations = [
      { id: AUTOMATION_ID, name: "Ebook", status: "active", trigger_type: "instagram_comment", trigger_config: { channelId: "ch-1", mediaId: null, keywords: ["ebook"], mode: "contains" }, mcp_spec: { nome: "Ebook" }, mcp_spec_stale: false, updated_at: "2026-10-26" },
      { id: "22222222-2222-4222-8222-222222222222", name: "Painel", status: "paused", trigger_type: "keyword_detected", trigger_config: { anyKeyword: true, keywords: [], mode: "any" }, mcp_spec: null, mcp_spec_stale: false, updated_at: "2026-10-25" },
    ];
    state.rpcResults.automation_run_counts = { data: [{ automation_id: AUTOMATION_ID, runs: 4 }], error: null };
    const mcp = await connect();
    const result = await mcp.callTool({ name: "listar_automacoes", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { automacoes: Row[] }).automacoes).toEqual([
      { id: AUTOMATION_ID, nome: "Ebook", status: "ativa", gatilho: "comentario", palavras: ["ebook"], post: "qualquer", criadaPeloClaude: true, alteradaNoPainel: false, disparos7dias: 4 },
      { id: "22222222-2222-4222-8222-222222222222", nome: "Painel", status: "pausada", gatilho: "dm", palavras: [], post: null, criadaPeloClaude: false, alteradaNoPainel: false, disparos7dias: 0 },
    ]);

    expect(state.rpcs).toEqual([["automation_run_counts", { p_org: "org-1", p_since: "2026-10-20T12:00:00.000Z" }]]);

    state.queries = [];
    await mcp.callTool({ name: "listar_automacoes", arguments: { status: "pausada" } });
    const automationsQuery = state.queries.find((q) => q.table === "automations");
    expect(automationsQuery?.filters).toContainEqual(["eq", "status", "paused"]);
    expect(automationsQuery?.filters).toContainEqual(["eq", "organization_id", "org-1"]);
  });

  it("ver_resultados_defaults_to_7_days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
    state.rpcResults.automation_results = {
      data: [
        {
          automationId: AUTOMATION_ID, name: "Ebook", status: "active", runs: 10, dmsSent: 9, publicReplies: 8, uniqueContacts: 7,
          clicks: { total: 5, byButton: [{ title: "Baixar", kind: "link", clicks: 3 }, { title: "Quero!", kind: "path", clicks: 2 }] },
        },
      ],
      error: null,
    };
    const mcp = await connect();
    const result = await mcp.callTool({ name: "ver_resultados", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(state.rpcs).toEqual([
      ["automation_results", { p_org: "org-1", p_from: "2026-10-20T12:00:00.000Z", p_to: "2026-10-27T12:00:00.000Z" }],
    ]);
    const structured = result.structuredContent as { periodo: Row; automacoes: Row[] };
    expect(structured.periodo).toEqual({ de: "2026-10-20T12:00:00.000Z", ate: "2026-10-27T12:00:00.000Z" });
    expect(structured.automacoes[0]).toEqual({
      id: AUTOMATION_ID, nome: "Ebook", status: "ativa", disparos: 10, dmsEnviadas: 9, respostasPublicas: 8, contatosUnicos: 7,
      cliques: { total: 5, porBotao: [{ titulo: "Baixar", tipo: "link", cliques: 3 }, { titulo: "Quero!", tipo: "caminho", cliques: 2 }] },
    });
    expect(text(result)).toContain("Ebook");
  });

  it("ver_resultados_rejects_91_days", async () => {
    state.rpcResults.automation_results = { data: [], error: null };
    const mcp = await connect();
    const tooLong = await mcp.callTool({ name: "ver_resultados", arguments: { de: "2026-07-01", ate: "2026-09-30" } });
    expect(tooLong.isError).toBe(true);
    expect(text(tooLong)).toContain("90 dias");
    expect(state.rpcs).toHaveLength(0);

    const ok = await mcp.callTool({ name: "ver_resultados", arguments: { de: "2026-07-01", ate: "2026-09-28", automacaoId: AUTOMATION_ID } });
    expect(ok.isError).toBeFalsy();
    expect(state.rpcs).toEqual([
      ["automation_results", { p_org: "org-1", p_from: "2026-07-01T00:00:00.000Z", p_to: "2026-09-28T23:59:59.999Z", p_automation: AUTOMATION_ID }],
    ]);

    const inverted = await mcp.callTool({ name: "ver_resultados", arguments: { de: "2026-09-28", ate: "2026-09-01" } });
    expect(inverted.isError).toBe(true);
  });

  it("listar_contatos_limits", async () => {
    state.rpcResults.mcp_contacts = {
      data: [{ id: "c-1", name: "Ana", username: "ana.ig", lastInteractionAt: "2026-10-26T10:00:00Z", automations: ["Ebook"] }],
      error: null,
    };
    const mcp = await connect();
    const result = await mcp.callTool({ name: "listar_contatos", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(state.rpcs).toEqual([["mcp_contacts", { p_org: "org-1", p_search: null, p_automation: null, p_limit: 20 }]]);
    expect((result.structuredContent as { contatos: Row[] }).contatos).toEqual([
      { id: "c-1", nome: "Ana", usuario: "@ana.ig", ultimaInteracao: "2026-10-26T10:00:00Z", automacoes: ["Ebook"] },
    ]);

    state.rpcs = [];
    await mcp.callTool({ name: "listar_contatos", arguments: { busca: "ana", automacaoId: AUTOMATION_ID, limite: 100 } });
    expect(state.rpcs).toEqual([["mcp_contacts", { p_org: "org-1", p_search: "ana", p_automation: AUTOMATION_ID, p_limit: 100 }]]);

    state.rpcs = [];
    const tooMany = await mcp.callTool({ name: "listar_contatos", arguments: { limite: 101 } });
    expect(tooMany.isError).toBe(true);
    expect(state.rpcs).toHaveLength(0);
  });

  it("creates_and_activates", async () => {
    state.rpcResults.save_mcp_automation = { data: AUTOMATION_ID, error: null };
    state.rpcResults.activate_automation = { data: 1, error: null };
    const mcp = await connect();
    const result = await mcp.callTool({ name: "criar_automacao", arguments: SPEC });
    expect(result.isError).toBeFalsy();
    const summary = text(result);
    for (const expected of ['"Ebook"', "criada e ativa", "comentário no Instagram", "ebook", "qualquer post"]) {
      expect(summary).toContain(expected);
    }

    const save = state.rpcs.find(([name]) => name === "save_mcp_automation");
    expect(save?.[1]).toMatchObject({
      p_org: "org-1",
      p_id: null,
      p_name: "Ebook",
      p_trigger_type: "instagram_comment",
      p_confirm_overwrite: false,
    });
    expect(save?.[1].p_spec).toMatchObject({
      nome: "Ebook",
      gatilho: "comentario",
      palavras: ["ebook"],
      post: "qualquer",
      dm: SPEC.dm,
      respostaPublica: SPEC.respostaPublica,
      umaVezPorContato: true,
    });
    expect(save?.[1].p_trigger_config).toMatchObject({ channelId: "ch-1", mediaId: null, keywords: ["ebook"], oncePerUser: true });

    // O banco guarda ids uuid; os ids determinísticos do formato simples são só do compilador.
    const graph = save?.[1].p_graph as { nodes: { id: string }[]; edges: { id: string; source: string; target: string }[] };
    const nodeIds = graph.nodes.map((n) => n.id);
    for (const id of nodeIds) expect(id).toMatch(UUID);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    for (const edge of graph.edges) {
      expect(edge.id).toMatch(UUID);
      expect(nodeIds).toContain(edge.source);
      expect(nodeIds).toContain(edge.target);
    }

    expect(state.rpcs).toContainEqual(["activate_automation", { p_id: AUTOMATION_ID }]);
    expect((result.structuredContent as { automacao: Row }).automacao).toMatchObject({
      id: AUTOMATION_ID,
      nome: "Ebook",
      status: "ativa",
      gatilho: "comentario",
      criadaPeloClaude: true,
      alteradaNoPainel: false,
    });

    state.rpcs = [];
    const draft = await mcp.callTool({ name: "criar_automacao", arguments: { ...SPEC, ativar: false } });
    expect(draft.isError).toBeFalsy();
    expect(text(draft)).toContain("criada como rascunho");
    expect(state.rpcs.map(([name]) => name)).toEqual(["save_mcp_automation"]);
  });

  it("create_validation_error_in_portuguese", async () => {
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "criar_automacao",
      arguments: { ...SPEC, palavras: Array.from({ length: 21 }, (_, i) => `palavra${i}`) },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Máximo de 20 palavras");
    expect(state.rpcs).toHaveLength(0);
  });

  it("create_requires_admin", async () => {
    state.memberships = [{ organization_id: "org-1", role: "agent", created_at: "2026-01-01" }];
    const mcp = await connect();
    const result = await mcp.callTool({ name: "criar_automacao", arguments: SPEC });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("administradores");
    expect(state.rpcs).toHaveLength(0);
  });

  it("post_must_belong_to_account", async () => {
    state.invokeResult = {
      data: { media: [{ id: "1790", caption: "outro", mediaType: "IMAGE", permalink: null, timestamp: null }] },
      error: null,
    };
    const mcp = await connect();
    const result = await mcp.callTool({ name: "criar_automacao", arguments: { ...SPEC, post: "1799" } });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("não está na conta");
    expect(state.rpcs).toHaveLength(0);
  });

  it("edit_partial_merges", async () => {
    state.automations = [automationRow()];
    state.nodes = seedNodes();
    state.rpcResults.save_mcp_automation = { data: AUTOMATION_ID, error: null };
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "editar_automacao",
      arguments: { id: AUTOMATION_ID, alteracoes: { palavras: ["guia"] } },
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("guia");
    expect(text(result)).toContain("atualizada");
    expect(text(result)).toContain("Antes → depois");
    expect(text(result)).toContain("ebook → guia");
    const save = state.rpcs.find(([name]) => name === "save_mcp_automation");
    expect(save?.[1]).toMatchObject({ p_id: AUTOMATION_ID, p_name: "Ebook", p_confirm_overwrite: false });
    expect(save?.[1].p_spec).toMatchObject({
      palavras: ["guia"],
      respostaPublica: SPEC.respostaPublica,
      dm: SPEC.dm,
    });
    expect(save?.[1].p_trigger_config).toMatchObject({ keywords: ["guia"], mediaId: null, channelId: "ch-1" });
    expect((result.structuredContent as { alteracoes: Row[] }).alteracoes).toEqual([
      { campo: "palavras", antes: "ebook", depois: "guia" },
    ]);
  });

  it("edit_switches_to_current_channel_when_stored_channel_is_gone", async () => {
    state.channels = [{ id: "ch-2", meta_connection_id: "conn-2", created_at: "2026-01-02" }];
    state.automations = [automationRow()];
    state.nodes = seedNodes();
    state.rpcResults.save_mcp_automation = { data: AUTOMATION_ID, error: null };
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "editar_automacao",
      arguments: { id: AUTOMATION_ID, alteracoes: { palavras: ["guia"] } },
    });
    expect(result.isError).toBeFalsy();
    const save = state.rpcs.find(([name]) => name === "save_mcp_automation");
    expect(save?.[1].p_trigger_config).toMatchObject({ keywords: ["guia"], channelId: "ch-2" });
    expect(text(result)).toContain("O canal do Instagram mudou");
  });

  it("edit_without_any_channel_returns_no_channel", async () => {
    state.channels = [];
    state.automations = [automationRow()];
    state.nodes = seedNodes();
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "editar_automacao",
      arguments: { id: AUTOMATION_ID, alteracoes: { palavras: ["guia"] } },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Nenhuma conta do Instagram conectada");
    expect(state.rpcs).toHaveLength(0);
  });

  it("edit_reuses_existing_node_ids", async () => {
    state.automations = [automationRow()];
    state.nodes = [nodeRow(END_NODE, "end", 320), nodeRow(TRIGGER_NODE, "trigger", 0), nodeRow(MESSAGE_NODE, "message", 160)];
    state.rpcResults.save_mcp_automation = { data: AUTOMATION_ID, error: null };
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "editar_automacao",
      arguments: { id: AUTOMATION_ID, alteracoes: { palavras: ["guia"] } },
    });
    expect(result.isError).toBeFalsy();
    const save = state.rpcs.find(([name]) => name === "save_mcp_automation");
    const graph = save?.[1].p_graph as { nodes: { id: string }[]; edges: { source: string; target: string }[] };
    expect(graph.nodes.map((node) => node.id)).toEqual([TRIGGER_NODE, MESSAGE_NODE, END_NODE]);
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      [TRIGGER_NODE, MESSAGE_NODE],
      [MESSAGE_NODE, END_NODE],
    ]);
  });

  it("edit_without_stored_graph_changes_nothing", async () => {
    state.automations = [automationRow()];
    state.nodes = [];
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "editar_automacao",
      arguments: { id: AUTOMATION_ID, alteracoes: { palavras: ["guia"] } },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Não foi possível carregar o grafo");
    expect(state.rpcs).toHaveLength(0);
  });

  it("edit_reports_nested_changes", async () => {
    state.automations = [automationRow()];
    state.nodes = seedNodes();
    state.rpcResults.save_mcp_automation = { data: AUTOMATION_ID, error: null };
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "editar_automacao",
      arguments: {
        id: AUTOMATION_ID,
        alteracoes: { dm: { texto: "Aqui está o ebook.", botoes: [{ titulo: "Baixar", url: "https://exemplo.com.br/novo.pdf" }] } },
      },
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("conteúdo alterado");
    expect((result.structuredContent as { alteracoes: Row[] }).alteracoes).toEqual([
      { campo: "dm", antes: expect.stringContaining("conteúdo alterado"), depois: expect.stringContaining("conteúdo alterado") },
    ]);
  });

  it("edit_invalid_patch_changes_nothing", async () => {
    state.automations = [automationRow()];
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "editar_automacao",
      arguments: { id: AUTOMATION_ID, alteracoes: { palavras: Array.from({ length: 21 }, (_, i) => `palavra${i}`) } },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Máximo de 20 palavras");
    expect(state.rpcs).toHaveLength(0);
  });

  it("edit_panel_modified_requires_confirmation", async () => {
    state.automations = [automationRow({ mcp_spec_stale: true })];
    state.nodes = seedNodes();
    state.rpcResults.save_mcp_automation = { data: AUTOMATION_ID, error: null };
    const mcp = await connect();
    const blocked = await mcp.callTool({
      name: "editar_automacao",
      arguments: { id: AUTOMATION_ID, alteracoes: { palavras: ["guia"] } },
    });
    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toContain("alterada no painel");
    expect(state.rpcs).toHaveLength(0);

    const confirmed = await mcp.callTool({
      name: "editar_automacao",
      arguments: { id: AUTOMATION_ID, alteracoes: { palavras: ["guia"] }, confirmarSobrescrever: true },
    });
    expect(confirmed.isError).toBeFalsy();
    const save = state.rpcs.find(([name]) => name === "save_mcp_automation");
    expect(save?.[1]).toMatchObject({ p_id: AUTOMATION_ID, p_confirm_overwrite: true });
  });

  it("edit_panel_created_refused", async () => {
    state.automations = [automationRow({ mcp_spec: null })];
    const mcp = await connect();
    const result = await mcp.callTool({
      name: "editar_automacao",
      arguments: { id: AUTOMATION_ID, alteracoes: { palavras: ["guia"] } },
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("criada no painel");
    expect(state.rpcs).toHaveLength(0);
  });

  it("pause_activate_summaries", async () => {
    state.automations = [automationRow()];
    state.rpcResults.pause_automation = { data: null, error: null };
    state.rpcResults.activate_automation = { data: 1, error: null };
    const mcp = await connect();

    const paused = await mcp.callTool({ name: "pausar_automacao", arguments: { id: AUTOMATION_ID } });
    expect(paused.isError).toBeFalsy();
    expect(text(paused)).toContain("pausada");
    expect(state.rpcs).toContainEqual(["pause_automation", { p_id: AUTOMATION_ID }]);
    expect((paused.structuredContent as { automacao: Row }).automacao).toMatchObject({ id: AUTOMATION_ID, status: "pausada" });

    state.automations = [automationRow({ status: "paused" })];
    state.rpcs = [];
    const activated = await mcp.callTool({ name: "ativar_automacao", arguments: { id: AUTOMATION_ID } });
    expect(activated.isError).toBeFalsy();
    expect(text(activated)).toContain("ativada");
    expect(state.rpcs).toContainEqual(["activate_automation", { p_id: AUTOMATION_ID }]);
    expect((activated.structuredContent as { automacao: Row }).automacao).toMatchObject({ id: AUTOMATION_ID, status: "ativa" });
  });

  it("delete_requires_confirm", async () => {
    state.automations = [automationRow()];
    state.rpcResults.delete_automation = { data: null, error: null };
    const mcp = await connect();
    const blocked = await mcp.callTool({ name: "excluir_automacao", arguments: { id: AUTOMATION_ID } });
    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toContain("confirmar");
    expect(state.rpcs).toHaveLength(0);

    const deleted = await mcp.callTool({ name: "excluir_automacao", arguments: { id: AUTOMATION_ID, confirmar: true } });
    expect(deleted.isError).toBeFalsy();
    expect(text(deleted)).toContain("excluída");
    expect(state.rpcs).toContainEqual(["delete_automation", { p_id: AUTOMATION_ID }]);
  });

  it("warns_overlap", async () => {
    state.rpcResults.save_mcp_automation = { data: AUTOMATION_ID, error: null };
    state.rpcResults.activate_automation = { data: 1, error: null };
    state.automations = [automationRow({ id: OTHER_ID, name: "Promo" })];
    const mcp = await connect();
    const created = await mcp.callTool({ name: "criar_automacao", arguments: SPEC });
    expect(created.isError).toBeFalsy();
    expect(text(created)).toContain("Promo");

    // Mesmo gatilho com outras palavras não é conflito.
    state.automations = [
      automationRow({
        id: OTHER_ID,
        name: "Promo",
        trigger_config: { channelId: "ch-1", mediaId: null, keywords: ["promo"], mode: "contains", oncePerUser: true },
      }),
    ];
    state.rpcs = [];
    const different = await mcp.callTool({ name: "criar_automacao", arguments: SPEC });
    expect(different.isError).toBeFalsy();
    expect(text(different)).not.toContain("Promo");

    state.automations = [
      automationRow({ id: AUTOMATION_ID, name: "Novo", status: "paused" }),
      automationRow({ id: OTHER_ID, name: "Promo" }),
    ];
    state.rpcs = [];
    const activated = await mcp.callTool({ name: "ativar_automacao", arguments: { id: AUTOMATION_ID } });
    expect(activated.isError).toBeFalsy();
    expect(text(activated)).toContain("Promo");
    const note = text(activated).split("Atenção:")[1] ?? "";
    expect(note).not.toContain("Novo");
  });

  it("rpc_failures_are_short_tool_errors", async () => {
    state.rpcResults.mcp_contacts = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const mcp = await connect();
    const result = await mcp.callTool({ name: "listar_contatos", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain("statement");
    expect(text(result)).toMatch(/^Não foi possível/);
  });
});
