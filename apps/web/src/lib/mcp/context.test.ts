import { beforeEach, describe, expect, it, vi } from "vitest";

type Membership = { organization_id: string; role: string; created_at: string };
type Channel = { id: string; meta_connection_id: string | null; created_at: string };

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  memberships: [] as Membership[],
  membershipsError: null as unknown,
  channels: [] as Channel[],
  channelsOrg: "org-1",
  createClientArgs: [] as unknown[][],
  getUserArgs: [] as unknown[],
  queries: [] as { table: string; filters: [string, string, unknown][] }[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => {
    state.createClientArgs.push(args);
    return {
      auth: {
        getUser: async (token: string) => {
          state.getUserArgs.push(token);
          return state.user
            ? { data: { user: state.user }, error: null }
            : { data: { user: null }, error: { message: "invalid JWT", status: 401 } };
        },
      },
      from: (table: string) => {
        const query = { table, filters: [] as [string, string, unknown][] };
        state.queries.push(query);
        const builder = {
          select: () => builder,
          eq: (k: string, v: unknown) => { query.filters.push(["eq", k, v]); return builder; },
          not: (k: string, op: string, v: unknown) => { query.filters.push([`not.${op}`, k, v]); return builder; },
          order: () => builder,
          limit: () => builder,
          then: (resolve: (value: unknown) => unknown) => {
            if (table === "memberships") return resolve({ data: state.memberships, error: state.membershipsError });
            const orgFilter = query.filters.find(([op, k]) => op === "eq" && k === "organization_id")?.[2];
            // Só devolve canais quando filtrado exatamente pela organização esperada.
            return resolve({ data: orgFilter === state.channelsOrg ? state.channels : [], error: null });
          },
        };
        return builder;
      },
    };
  },
}));

import { resolveMcpContext } from "./context";

const METADATA = 'resource_metadata="https://app.example.com/.well-known/oauth-protected-resource/mcp"';

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode(payload)}.signature`;
}

const OAUTH_TOKEN = jwt({ sub: "user-1", role: "authenticated", client_id: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d" });

function request(authorization?: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "x-forwarded-host": "app.example.com", "x-forwarded-proto": "https", ...extra };
  if (authorization) headers.authorization = authorization;
  return new Request("http://internal/mcp", { method: "POST", headers });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  state.user = { id: "user-1" };
  state.memberships = [{ organization_id: "org-1", role: "owner", created_at: "2026-01-01" }];
  state.membershipsError = null;
  state.channels = [{ id: "ch-1", meta_connection_id: "conn-1", created_at: "2026-01-01" }];
  state.channelsOrg = "org-1";
  state.createClientArgs = [];
  state.getUserArgs = [];
  state.queries = [];
});

describe("resolveMcpContext", () => {
  it("rejects_missing_token", async () => {
    const result = await resolveMcpContext(request());
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer ${METADATA}`);
    expect(state.getUserArgs).toEqual([]);
  });

  it.each(["Basic abc", "Bearer", "Bearer    "])("rejects_missing_token for malformed header %j", async (header) => {
    const response = (await resolveMcpContext(request(header))) as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(METADATA);
  });

  it("rejects_invalid_token", async () => {
    state.user = null;
    const response = (await resolveMcpContext(request("Bearer bad-token"))) as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(METADATA);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(state.getUserArgs).toEqual(["bad-token"]);
  });

  it.each([
    ["browser session token without client_id", jwt({ sub: "user-1", role: "authenticated", session_id: "s" })],
    ["empty client_id", jwt({ sub: "user-1", client_id: "" })],
    ["non-string client_id", jwt({ sub: "user-1", client_id: 123 })],
    ["payload that is not JSON", "aGVhZGVy.bm90LWpzb24.sig"],
    ["token without payload segment", "opaque-token"],
  ])("rejects_invalid_token: %s (valid for getUser but not OAuth-issued)", async (_name, token) => {
    const response = (await resolveMcpContext(request(`Bearer ${token}`))) as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`Bearer error="invalid_token", ${METADATA}`);
    expect(await response.json()).toEqual({ error: "invalid_token" });
    expect(state.queries).toEqual([]);
  });

  it("rejects_user_without_org", async () => {
    state.memberships = [];
    const response = (await resolveMcpContext(request(`Bearer ${OAUTH_TOKEN}`))) as Response;
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(await response.json()).toEqual({ error: "no_organization" });
  });

  it("creates a user-scoped client with the anon key and the bearer token", async () => {
    await resolveMcpContext(request(`bearer ${OAUTH_TOKEN}`));
    const [url, key, options] = state.createClientArgs[0] as [string, string, { global: { headers: Record<string, string> }; auth: Record<string, boolean> }];
    expect(url).toBe("https://ref.supabase.co");
    expect(key).toBe("anon-key");
    expect(options.global.headers.Authorization).toBe(`Bearer ${OAUTH_TOKEN}`);
    expect(options.auth.persistSession).toBe(false);
    expect(options.auth.autoRefreshToken).toBe(false);
    expect(state.getUserArgs).toEqual([OAUTH_TOKEN]);
  });

  it("resolves the organization and the active Instagram channel", async () => {
    const context = await resolveMcpContext(request(`Bearer ${OAUTH_TOKEN}`));
    expect(context).not.toBeInstanceOf(Response);
    if (context instanceof Response) return;
    expect(context).toMatchObject({
      userId: "user-1",
      orgId: "org-1",
      role: "owner",
      channel: { id: "ch-1", connectionId: "conn-1" },
      accessToken: OAUTH_TOKEN,
    });
    expect(context.supabase).toBeDefined();
    const channelQuery = state.queries.find((q) => q.table === "channels")!;
    expect(channelQuery.filters).toEqual([
      ["eq", "organization_id", "org-1"],
      ["eq", "type", "instagram"],
      ["eq", "status", "active"],
      ["not.is", "meta_connection_id", null],
    ]);
    const membershipQuery = state.queries.find((q) => q.table === "memberships")!;
    expect(membershipQuery.filters).toEqual([["eq", "user_id", "user-1"]]);
  });

  it("prefers the first membership where the user is owner or admin", async () => {
    state.memberships = [
      { organization_id: "org-viewer", role: "viewer", created_at: "2026-01-01" },
      { organization_id: "org-admin", role: "admin", created_at: "2026-02-01" },
      { organization_id: "org-owner", role: "owner", created_at: "2026-03-01" },
    ];
    state.channelsOrg = "org-admin";
    const context = await resolveMcpContext(request(`Bearer ${OAUTH_TOKEN}`));
    expect(context).toMatchObject({ orgId: "org-admin", role: "admin", channel: { id: "ch-1", connectionId: "conn-1" } });
  });

  it("falls back to the first membership when the user is not admin anywhere", async () => {
    state.memberships = [
      { organization_id: "org-agent", role: "agent", created_at: "2026-01-01" },
      { organization_id: "org-viewer", role: "viewer", created_at: "2026-02-01" },
    ];
    state.channelsOrg = "org-agent";
    const context = await resolveMcpContext(request(`Bearer ${OAUTH_TOKEN}`));
    expect(context).toMatchObject({ orgId: "org-agent", role: "agent", channel: { id: "ch-1" } });
  });

  it("does not return a channel of another organization", async () => {
    state.channelsOrg = "org-other";
    expect(await resolveMcpContext(request(`Bearer ${OAUTH_TOKEN}`))).toMatchObject({ orgId: "org-1", channel: null });
  });

  it("returns channel null when there is no active Instagram channel", async () => {
    state.channels = [];
    expect(await resolveMcpContext(request(`Bearer ${OAUTH_TOKEN}`))).toMatchObject({ channel: null });
  });

  it("returns 500 without details when the membership query fails", async () => {
    state.membershipsError = { message: "boom" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = (await resolveMcpContext(request(`Bearer ${OAUTH_TOKEN}`))) as Response;
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
    errorSpy.mockRestore();
  });
});
