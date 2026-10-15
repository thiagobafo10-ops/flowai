import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "admin",
  channel: true,
  status: "active",
  metaConnectionId: "20000000-0000-4000-8000-000000000001" as string | null,
  invokes: [] as unknown[],
  mockMedia: [
    { id: "1001", caption: "Post 1", mediaType: "IMAGE", mediaUrl: "https://img/1", thumbnailUrl: null, permalink: "https://ig/1", timestamp: "2026-10-14T10:00:00Z" }
  ]
}));

vi.mock("@/lib/org/active-org", () => ({ getActiveOrg: async () => ({ id: "org", role: state.role }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u" } } }),
      getSession: async () => ({ data: { session: { access_token: "local" } } })
    },
    from: () => {
      const q = {
        select: () => q,
        eq: (key: string, value: string) => {
          if (key === "organization_id" && value !== "org") throw Error("tenant");
          return q;
        },
        maybeSingle: async () => ({
          data: state.channel
            ? { id: "10000000-0000-4000-8000-000000000001", status: state.status, meta_connection_id: state.metaConnectionId }
            : null,
          error: null
        })
      };
      return q;
    },
    functions: {
      invoke: async (...args: unknown[]) => {
        state.invokes.push(args);
        return { data: { media: state.mockMedia }, error: null };
      }
    }
  })
}));

import { listInstagramMedia } from "./actions";

const validChannel = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  state.role = "admin";
  state.channel = true;
  state.status = "active";
  state.metaConnectionId = "20000000-0000-4000-8000-000000000001";
  state.invokes = [];
});

test("listInstagramMedia rejeita roles não-administrativos", async () => {
  state.role = "agent";
  const res = await listInstagramMedia(validChannel);
  expect(res.ok).toBe(false);
  expect(state.invokes).toHaveLength(0);
});

test("listInstagramMedia rejeita canal inválido ou não pertencente", async () => {
  expect((await listInstagramMedia("not-a-uuid")).ok).toBe(false);
  state.channel = false;
  expect((await listInstagramMedia(validChannel)).ok).toBe(false);
  expect(state.invokes).toHaveLength(0);
});

test("listInstagramMedia retorna lista vazia se canal não estiver ativo", async () => {
  state.status = "needs_setup";
  const res = await listInstagramMedia(validChannel);
  expect(res).toEqual({ ok: true, data: { media: [] } });
  expect(state.invokes).toHaveLength(0);
});

test("listInstagramMedia invoca meta-connection e retorna as publicações", async () => {
  const res = await listInstagramMedia(validChannel);
  expect(res.ok).toBe(true);
  if (res.ok) {
    expect(res.data.media).toEqual(state.mockMedia);
  }
  expect(state.invokes[0]).toMatchObject([
    "meta-connection",
    {
      body: {
        organizationId: "org",
        action: "list_media",
        channelId: validChannel,
        connectionId: "20000000-0000-4000-8000-000000000001"
      }
    }
  ]);
});
