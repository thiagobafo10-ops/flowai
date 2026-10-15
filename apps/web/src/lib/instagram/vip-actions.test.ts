import { beforeEach, expect, test, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "admin", rpcError: false, channel: true, writes: [] as unknown[], invokes: [] as unknown[] }));
vi.mock("@/lib/org/active-org", () => ({ getActiveOrg: async () => ({ id: "org", role: state.role }) }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u" } } }), getSession: async () => ({ data: { session: { access_token: "local" } } }) }, from: () => { const q = { select: () => q, eq: (key: string, value: string) => { if (key === "organization_id" && value !== "org") throw Error("tenant"); return q; }, maybeSingle: async () => ({ data: state.channel ? { id: "10000000-0000-4000-8000-000000000001", status: "active", meta_connection_id: "20000000-0000-4000-8000-000000000001" } : null, error: null }) }; return q; }, rpc: async (...args: unknown[]) => { state.writes.push(args); return { data: {}, error: state.rpcError ? { code: "22023", message: "opaque backend text" } : null }; }, functions: { invoke: async (...args: unknown[]) => { state.invokes.push(args); return { data: { verified: true }, error: null }; } } }) }));
import { saveInstagramVipSettings, verifyInstagramVipPermission } from "./actions";
const input = { channelId: "10000000-0000-4000-8000-000000000001", enabled: false, publicReplyText: "VIP", groupUrl: "https://chat.whatsapp.com/code" };
beforeEach(() => { state.role = "admin"; state.rpcError = false; state.channel = true; state.writes = []; state.invokes = []; });
test("VIP actions forbid non-admins before writing", async () => { state.role = "agent"; expect((await saveInstagramVipSettings(input)).ok).toBe(false); expect(state.writes).toHaveLength(0); });
test("VIP actions reject another organization's channel", async () => { state.channel = false; expect((await saveInstagramVipSettings(input)).ok).toBe(false); expect((await verifyInstagramVipPermission(input.channelId)).ok).toBe(false); expect(state.writes).toHaveLength(0); expect(state.invokes).toHaveLength(0); });
test("VIP drafts save explicitly disabled and permission verification binds the owned connection", async () => { expect((await saveInstagramVipSettings(input)).ok).toBe(true); expect(state.writes).toEqual([["save_instagram_vip_settings", { p_channel_id: input.channelId, p_enabled: false, p_public_reply_text: "VIP", p_group_url: "https://chat.whatsapp.com/code" }]]); expect((await verifyInstagramVipPermission(input.channelId)).ok).toBe(true); expect(state.invokes[0]).toMatchObject(["meta-connection", { body: { organizationId: "org", action: "verify_vip", channelId: input.channelId, connectionId: "20000000-0000-4000-8000-000000000001" } }]); });
test("invalid drafts never reach persistence", async () => { expect((await saveInstagramVipSettings({ ...input, groupUrl: "https://evil.test" })).ok).toBe(false); expect(state.writes).toHaveLength(0); });

test("activation rejected by the database guides permission verification without raw errors", async () => {
 state.rpcError = true;
 const result = await saveInstagramVipSettings({ ...input, enabled: true });
 expect(result).toEqual({ ok: false, error: "Reconecte o Instagram com as permissões de comentários e mensagens e verifique novamente." });
});
