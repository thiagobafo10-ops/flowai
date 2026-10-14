import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "admin", authenticated: true, error: null as null | { code: string; message?: string }, calls: [] as unknown[][] }));
vi.mock("@/lib/org/active-org", () => ({ getActiveOrg: async () => ({ id: "org", role: state.role }) }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: "u" } : null } }) },
  rpc: async (...args: unknown[]) => { state.calls.push(args); return { data: "result-id", error: state.error }; },
}) }));
import { archiveEntryLink, saveEntryLink, setInstagramUsername, simulateEntryLink } from "./actions";

const ID = "00000000-0000-4000-8000-000000000001";
const input = { name: "Promoção", channelId: ID, tagId: null, code: "promo" };
beforeEach(() => { state.role = "admin"; state.authenticated = true; state.error = null; state.calls = []; });

test("código ocupado retorna a orientação específica, sem expor erro do banco", async () => {
  state.error = { code: "22023", message: "code_taken" };
  expect(await saveEntryLink({ input })).toEqual({ ok: false, error: "Este código já está em uso neste canal." });
});
test("save envia input validado e identificadores para a RPC", async () => {
  expect(await saveEntryLink({ input: { ...input, name: " Promoção " } })).toEqual({ ok: true, data: { id: "result-id" } });
  expect(state.calls).toEqual([["save_entry_link", { p_org: "org", p_id: null, p_input: input }]]);
});
test("viewer não escreve nem simula; agent só simula", async () => {
  state.role = "viewer";
  expect((await saveEntryLink({ input })).ok).toBe(false);
  expect((await archiveEntryLink(ID)).ok).toBe(false);
  expect((await setInstagramUsername(ID, "loja")).ok).toBe(false);
  expect((await simulateEntryLink({ linkId: ID, phone: "5511999999999", name: "Ana" })).ok).toBe(false);
  expect(state.calls).toHaveLength(0);
  state.role = "agent";
  expect((await saveEntryLink({ input })).ok).toBe(false);
  expect(await simulateEntryLink({ linkId: ID, phone: " 5511999999999 ", name: " Ana " })).toEqual({ ok: true, data: { conversationId: "result-id" } });
  expect(state.calls).toEqual([["simulate_entry_link", { p_link: ID, p_contact_phone: "5511999999999", p_contact_name: "Ana" }]]);
});
test("input inválido e sessão ausente não alcançam a RPC", async () => {
  expect((await saveEntryLink({ input: { ...input, code: "BAD" } })).ok).toBe(false);
  expect((await archiveEntryLink("bad")).ok).toBe(false);
  expect((await simulateEntryLink({ linkId: ID, phone: "", name: "" })).ok).toBe(false);
  expect((await setInstagramUsername(ID, "invalid/username")).ok).toBe(false);
  state.authenticated = false;
  expect((await saveEntryLink({ input })).ok).toBe(false);
  expect(state.calls).toHaveLength(0);
});
test("arquivar e atualizar usuário usam contratos do banco", async () => {
  expect((await archiveEntryLink(ID)).ok).toBe(true);
  expect((await setInstagramUsername(ID, " @Loja.X ")).ok).toBe(true);
  expect(state.calls).toEqual([["archive_entry_link", { p_id: ID }], ["set_instagram_username", { p_channel: ID, p_username: "loja.x" }]]);
  state.error = { code: "P0002" };
  expect((await archiveEntryLink(ID)).ok).toBe(false);
});
