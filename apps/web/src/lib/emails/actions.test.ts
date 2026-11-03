import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "admin",
  settingsRow: true as boolean,
  rpcs: [] as unknown[][],
  invokes: [] as unknown[][],
}));
vi.mock("@/lib/org/active-org", () => ({ getActiveOrg: async () => ({ id: "org", role: state.role }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u" } } }),
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
    },
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: state.settingsRow ? { organization_id: "org" } : null, error: null }) };
      return q;
    },
    rpc: async (...args: unknown[]) => { state.rpcs.push(args); return { data: null, error: null }; },
    functions: { invoke: async (...args: unknown[]) => { state.invokes.push(args); return { data: { sent: true }, error: null }; } },
  }),
}));
import { saveSettings, saveStep, sendTestEmail } from "./actions";

const STEP = "10000000-0000-4000-8000-000000000001";
const step = { delayMinutes: 60, enabled: true, subject: "Oi", heading: "", body: "Texto", buttonLabel: "Comprar", coupon: "" };
const settings = { fromName: "Loja", fromEmail: "loja@exemplo.com", replyTo: "", resendKey: "", resendWebhookSecret: "" };
beforeEach(() => { state.role = "admin"; state.settingsRow = true; state.rpcs = []; state.invokes = []; });

test("saveStep forbids non-admins without writing", async () => {
  state.role = "agent";
  expect(await saveStep(STEP, step)).toEqual({ ok: false, error: "Você não tem permissão para esta ação." });
  expect(state.rpcs).toHaveLength(0);
});

test("saveStep sends the validated step to the RPC", async () => {
  expect((await saveStep(STEP, step)).ok).toBe(true);
  expect(state.rpcs).toEqual([["save_email_journey_step", { p_org: "org", p_step: STEP, p_input: step }]]);
});

test("saveSettings without a new key keeps the current one (does not send resendKey)", async () => {
  expect((await saveSettings(settings)).ok).toBe(true);
  const input = (state.rpcs[0][1] as { p_input: Record<string, unknown> }).p_input;
  expect(input).toEqual({ fromName: "Loja", fromEmail: "loja@exemplo.com", replyTo: "" });
  expect(input).not.toHaveProperty("resendKey");
  expect(input).not.toHaveProperty("resendWebhookSecret");
});

test("saveSettings requires both secrets on the first save", async () => {
  state.settingsRow = false;
  expect((await saveSettings(settings)).ok).toBe(false);
  expect(state.rpcs).toHaveLength(0);
});

test("sendTestEmail calls email-admin with the user's token", async () => {
  expect((await sendTestEmail(STEP)).ok).toBe(true);
  expect(state.invokes[0]).toEqual(["email-admin", { body: { organizationId: "org", action: "test", stepId: STEP }, headers: { Authorization: "Bearer tok" } }]);
});
