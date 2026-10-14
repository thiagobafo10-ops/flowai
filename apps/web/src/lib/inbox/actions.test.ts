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
  role: "agent",
  channelType: "simulator",
  invocations: [] as unknown[],
  deliveryState: "sent",
  intentError: null as null | { code: string; message: string },
  returnError: null as null | { code: string; message: string }
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
      getSession: async () => ({ data: { session: { access_token: "user-jwt" } } }),
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
      if (args[0] === "return_to_ai" && state.returnError) return { data: null, error: state.returnError };
      if ((args[0] === "click_automation_button" || args[0] === "stop_automation") && state.returnError) return { data: null, error: state.returnError };
      if (args[0] === "create_instagram_send_intent" && state.intentError) return { data: null, error: state.intentError };
      return {
        data: args[0] === "create_instagram_send_intent" ? "00000000-0000-4000-8000-000000000003" : null,
        error: null
      };
    },
    functions: { invoke: async (...args: unknown[]) => { state.invocations.push(args); return { data: { state: state.deliveryState, messageId: "message" }, error: null }; } },
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
              type: state.channelType
            },
            contacts: {
              phone: "phone",
              instagram_id: "instagram-user"
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
import { takeOver, closeConversation, reopenConversation, sendReply, addInternalNote, markRead, returnToAi, clickAutomationButton } from "./actions";
import { stopAutomation } from "@/lib/automation/actions";
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
  state.channelType = "simulator";
  state.invocations = [];
  state.deliveryState = "sent";
  state.intentError = null;
  state.returnError = null;
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
test("Instagram replies create an intent and invoke Edge with user JWT instead of writing generic pending messages", async () => {
  state.channelType = "instagram";
  expect((await sendReply("00000000-0000-4000-8000-000000000002", "Oi")).ok).toBe(true);
  expect(state.writes).toEqual([]);
  expect(state.logs[0]).toEqual(["create_instagram_send_intent", expect.objectContaining({ p_text: "Oi" })]);
  expect(state.invocations).toEqual([["send-message", { body: { intentId: "00000000-0000-4000-8000-000000000003" }, headers: { Authorization: "Bearer user-jwt" } }]]);
});
test("Instagram validates UTF-8 bytes before creating an intent", async () => {
  state.channelType = "instagram";
  expect((await sendReply("00000000-0000-4000-8000-000000000002", "á".repeat(501))).ok).toBe(false);
  expect(state.logs).toEqual([]);
  expect(state.invocations).toEqual([]);
});
test("uncertain Instagram send is returned as accepted with warning so the composer does not keep a resend draft", async () => {
  state.channelType = "instagram";
  state.deliveryState = "uncertain";
  expect(await sendReply("00000000-0000-4000-8000-000000000002", "Oi")).toMatchObject({ ok: true, data: { messageId: "message", deliveryState: "uncertain" } });
});
test("closed Instagram 24h window has its own message", async () => {
  state.channelType = "instagram"; state.intentError = { code: "22023", message: "messaging window closed" };
  expect(await sendReply("00000000-0000-4000-8000-000000000002", "Olá")).toEqual({ ok: false, error: "A janela de 24 horas do Instagram expirou. Aguarde uma nova mensagem do contato para responder." });
  expect(state.invocations).toEqual([]);
});
test("other Instagram validation errors are not reported as the 24h window", async () => {
  state.channelType = "instagram"; state.intentError = { code: "22023", message: "conversation unavailable" };
  const result = await sendReply("00000000-0000-4000-8000-000000000002", "Olá");
  expect(result.ok).toBe(false);
  expect(result.ok ? "" : result.error).toBe("Confira se o canal do Instagram está ativo e tente novamente.");
});
const CONV = "00000000-0000-4000-8000-000000000002";
test("viewers cannot return a conversation to the AI", async () => {
  state.role = "viewer";
  expect(await returnToAi(CONV)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  expect(state.logs).toEqual([]);
});
test("returnToAi calls the RPC and succeeds", async () => {
  expect(await returnToAi(CONV)).toEqual({ ok: true, data: undefined });
  expect(state.logs).toContainEqual(["return_to_ai", { p_conversation: CONV }]);
});
test("returnToAi explains when the AI agent is inactive", async () => {
  state.returnError = { code: "22023", message: "ai inactive" };
  expect(await returnToAi(CONV)).toEqual({ ok: false, error: "Ative o agente de IA com resposta automática para devolver a conversa." });
});
test("returnToAi explains unsupported channels", async () => {
  state.returnError = { code: "22023", message: "ai unsupported channel" };
  expect(await returnToAi(CONV)).toEqual({ ok: false, error: "A IA não atende conversas deste canal." });
});
test("returnToAi maps 42501 and unexpected errors", async () => {
  state.returnError = { code: "42501", message: "forbidden" };
  expect(await returnToAi(CONV)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  state.returnError = { code: "XX000", message: "boom" };
  expect(await returnToAi(CONV)).toEqual({ ok: false, error: "Não foi possível concluir. Tente novamente." });
});
test("returnToAi rejects an invalid id without calling the RPC", async () => {
  expect(await returnToAi("nope")).toEqual({ ok: false, error: "Esta conversa não existe mais." });
  expect(state.logs).toEqual([]);
});
const MSG = "00000000-0000-4000-8000-000000000004";
test("clickAutomationButton calls the RPC for agents", async () => {
  expect(await clickAutomationButton(MSG, "a1")).toEqual({ ok: true, data: undefined });
  expect(state.logs).toContainEqual(["click_automation_button", { p_message_id: MSG, p_option_id: "a1" }]);
});
test("clickAutomationButton blocks viewers and malformed input without calling the RPC", async () => {
  state.role = "viewer";
  expect(await clickAutomationButton(MSG, "a1")).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  state.role = "agent";
  expect(await clickAutomationButton("nope", "a1")).toEqual({ ok: false, error: "Este botão não está mais disponível." });
  expect(await clickAutomationButton(MSG, "A B")).toEqual({ ok: false, error: "Este botão não está mais disponível." });
  expect(state.logs).toEqual([]);
});
test("clickAutomationButton maps server errors to Portuguese copy", async () => {
  state.returnError = { code: "22023", message: "not_waiting" };
  expect(await clickAutomationButton(MSG, "a1")).toEqual({ ok: false, error: "Este botão não está mais disponível." });
  state.returnError = { code: "22023", message: "unknown_option" };
  expect(await clickAutomationButton(MSG, "a1")).toEqual({ ok: false, error: "Este botão não está mais disponível." });
  state.returnError = { code: "22023", message: "not_simulator" };
  expect(await clickAutomationButton(MSG, "a1")).toEqual({ ok: false, error: "Só é possível clicar nos botões em conversas do Simulador." });
  state.returnError = { code: "42501", message: "forbidden" };
  expect(await clickAutomationButton(MSG, "a1")).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  state.returnError = { code: "XX000", message: "boom" };
  expect(await clickAutomationButton(MSG, "a1")).toEqual({ ok: false, error: "Não foi possível concluir. Tente novamente." });
});
test("stopAutomation (Parar automação) works for agents and maps errors", async () => {
  expect(await stopAutomation(CONV)).toEqual({ ok: true, data: undefined });
  expect(state.logs).toContainEqual(["stop_automation", { p_conversation: CONV }]);
  state.returnError = { code: "42501", message: "forbidden" };
  expect(await stopAutomation(CONV)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  state.returnError = null;
  state.role = "viewer";
  expect(await stopAutomation(CONV)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
});
