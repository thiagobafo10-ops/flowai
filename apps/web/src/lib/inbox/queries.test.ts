import { expect, test, vi } from "vitest";
type InboxRow = {
  id: string;
  contact_id: string;
  contact_name: string;
  channel_id: string;
  channel_type: "simulator";
  status: "open";
  handled_by: "human";
  last_message_at: string;
  preview: string;
  preview_from_team: boolean;
};
type RpcArgs = Record<string, string | number | null>;
type QueryChain = {
  select(): QueryChain;
  eq(): QueryChain;
  neq(): QueryChain;
  is(): QueryChain;
  order(): QueryChain;
  limit(): QueryChain;
  then(resolve: (value: {
    data: never[];
    count: number;
    error: null;
  }) => unknown): unknown;
};
const state = vi.hoisted(() => ({
  rpcCalls: [] as [
    string,
    RpcArgs
  ][],
  rows: [] as InboxRow[]
}));
vi.mock("@/lib/crm/queries", () => ({
  listMembers: async () => []
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: async (name: string, args: RpcArgs) => {
      state.rpcCalls.push([name, args]);
      return {
        data: name === "list_inbox" ? state.rows : {
          minhas: 0,
          "nao-atribuidas": 51,
          aguardando: 0,
          todas: 51,
          fechadas: 0
        },
        error: null
      };
    },
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "user"
          }
        }
      })
    },
    from: () => {
      const q: QueryChain = {
        select: () => q,
        eq: () => q,
        neq: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        then: r => r({
          data: [],
          count: 0,
          error: null
        })
      };
      return q;
    }
  })
}));
import { listConversations } from "./queries";
test("the server lists through SQL and preserves timestamp precision in a compound cursor", async () => {
  state.rows = Array.from({
    length: 51
  }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    contact_id: "contact",
    contact_name: "Ana",
    channel_id: "channel",
    channel_type: "simulator",
    status: "open",
    handled_by: "human",
    last_message_at: "2026-10-11T12:00:00.123456+00:00",
    preview: "Oi",
    preview_from_team: false
  }));
  const result = await listConversations("org", {
    tab: "todas",
    q: "",
    channelId: null
  });
  expect(result.items).toHaveLength(50);
  expect(result.nextCursor).toBe(`${state.rows[49].last_message_at}|${state.rows[49].id}`);
  await listConversations("org", {
    tab: "todas",
    q: "",
    channelId: null,
    cursor: result.nextCursor!
  });
  expect(state.rpcCalls.at(-2)![1]).toMatchObject({
    p_cursor_at: state.rows[49].last_message_at,
    p_cursor_id: state.rows[49].id
  });
});
