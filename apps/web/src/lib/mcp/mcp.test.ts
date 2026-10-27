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
          const rows = table === "memberships" ? state.memberships : table === "channels" ? state.channels : state.automations;
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
    expect(names).toEqual(expect.arrayContaining(["listar_posts", "listar_automacoes", "ver_resultados", "listar_contatos"]));
    for (const tool of tools) expect(tool.description?.length ?? 0).toBeGreaterThan(40);
  });
  it.todo("lists_tools includes criar_automacao, editar_automacao, pausar_automacao, ativar_automacao, excluir_automacao (Task 7)");

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

  it("rpc_failures_are_short_tool_errors", async () => {
    state.rpcResults.mcp_contacts = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const mcp = await connect();
    const result = await mcp.callTool({ name: "listar_contatos", arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain("statement");
    expect(text(result)).toMatch(/^Não foi possível/);
  });
});
