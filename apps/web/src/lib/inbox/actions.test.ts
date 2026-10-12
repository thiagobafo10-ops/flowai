import { afterEach, beforeEach, expect, test, vi } from "vitest";
type QueryChain = {
  select(): QueryChain;
  eq(column: string, value: unknown): QueryChain;
  update(p: unknown): QueryChain;
  insert(p: unknown): QueryChain;
  maybeSingle(): Promise<unknown>;
  single(): Promise<unknown>;
  then(resolve: (value: {
    data: {
      id: string;
    }[];
    error: null;
  }) => unknown): unknown;
};
const state = vi.hoisted(() => ({
  status: "open",
  assigned_to: "00000000-0000-4000-8000-000000000001",
  writes: [] as unknown[],
  logs: [] as unknown[],
  failSend: false,
  foreignConversation: false,
  role: "agent"
}));
vi.mock("@/lib/org/active-org", () => ({
  getActiveOrg: async () => ({
    id: "org",
    role: state.role
  })
}));
vi.mock("@flowai/core", async (load) => ({
  ...await load<object>(),
  providerFor: () => ({
    sendMessage: async () => {
      if (state.failSend)
        throw new Error("SECRET token");
    }
  })
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: state.assigned_to
          }
        }
      })
    },
    rpc: async (...args: unknown[]) => {
      state.logs.push(args);
      return {
        error: null
      };
    },
    from: () => {
      const filters = new Map<string, unknown>();
      const q: QueryChain = {
        select: () => q,
        eq: (column: string, value: unknown) => {
          filters.set(column, value);
          return q;
        },
        update: (p: unknown) => {
          state.writes.push(p);
          return q;
        },
        insert: (p: unknown) => {
          state.writes.push(p);
          return q;
        },
        maybeSingle: async () => ({
          data: state.foreignConversation && filters.get("organization_id") === "org" ? null : {
            id: "00000000-0000-4000-8000-000000000002",
            status: state.status,
            assigned_to: state.assigned_to,
            handled_by: "human",
            channels: {
              type: "simulator"
            },
            contacts: {
              phone: "phone"
            }
          },
          error: null
        }),
        single: async () => ({
          data: {
            id: "message"
          },
          error: null
        }),
        then: resolve => resolve({
          data: [{
              id: "message"
            }],
          error: null
        })
      };
      return q;
    }
  })
}));
import { takeOver, closeConversation, reopenConversation, sendReply, addInternalNote, markRead } from "./actions";
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {
  });
  state.status = "open";
  state.writes = [];
  state.logs = [];
  state.failSend = false;
  state.foreignConversation = false;
  state.role = "agent";
});
test("assuming an already owned human conversation produces no duplicate event", async () => {
  expect((await takeOver("00000000-0000-4000-8000-000000000002")).ok).toBe(true);
  expect(state.logs).toEqual([]);
  expect(state.writes).toEqual([]);
});
test("closing an already closed conversation preserves its timestamp and history", async () => {
  state.status = "closed";
  await closeConversation("00000000-0000-4000-8000-000000000002");
  expect(state.writes).toEqual([]);
  expect(state.logs).toEqual([]);
});
test("reopening an open conversation produces no duplicate event", async () => {
  await reopenConversation("00000000-0000-4000-8000-000000000002");
  expect(state.writes).toEqual([]);
  expect(state.logs).toEqual([]);
});
test("provider errors persist only a safe Portuguese message", async () => {
  state.failSend = true;
  await sendReply("00000000-0000-4000-8000-000000000002", "Oi");
  expect(state.writes).toContainEqual({
    status: "failed",
    error: "Falha ao enviar pelo canal."
  });
});
test("internal notes use allowed insert columns and become delivered afterwards", async () => {
  await addInternalNote("00000000-0000-4000-8000-000000000002", "nota");
  expect(state.writes[0]).not.toHaveProperty("status");
  expect(state.writes).toContainEqual({
    status: "delivered"
  });
});
test("markRead refuses a conversation outside the active organization even for a member of both", async () => {
  state.foreignConversation = true;
  expect(await markRead("00000000-0000-4000-8000-000000000002")).toEqual({
    ok: false,
    error: "Esta conversa n\u00E3o existe mais."
  });
  expect(state.logs).toEqual([]);
});
test("viewers can mark a conversation in the active organization as read", async () => {
  state.role = "viewer";
  expect((await markRead("00000000-0000-4000-8000-000000000002")).ok).toBe(true);
  expect(state.logs).toContainEqual(["mark_conversation_read", {
      p_conversation: "00000000-0000-4000-8000-000000000002"
    }]);
});
