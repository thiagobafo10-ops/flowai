import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "agent",
  rpcs: [] as unknown[][],
  result: { data: null, error: null } as { data: unknown; error: unknown },
}));
vi.mock("@/lib/org/active-org", () => ({ getActiveOrg: async () => ({ id: "org", role: state.role }) }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: async (...args: unknown[]) => { state.rpcs.push(args); return state.result; },
  }),
}));
import { confirmSent, prepareWhatsapp, recordAction, saveRecoverySettings, savePermission, setBlocked } from "./actions";

const CART = "10000000-0000-4000-8000-000000000001";
const CONTACT = "10000000-0000-4000-8000-000000000002";
const KEY = "20000000-0000-4000-8000-000000000003";
const FORBIDDEN = { ok: false, error: "Você não tem permissão para esta ação." };
beforeEach(() => { state.role = "agent"; state.rpcs = []; state.result = { data: null, error: null }; });

test("prepareWhatsapp blocked returns the reason and no url", async () => {
  state.result = { data: { blocked: "Atendimento pausado" }, error: null };
  const r = await prepareWhatsapp(CART, KEY);
  expect(r).toEqual({ ok: true, data: { blocked: "Atendimento pausado" } });
  expect(state.rpcs).toEqual([["prepare_cart_whatsapp", { p_org: "org", p_cart: CART, p_request_key: KEY }]]);
});

test("prepareWhatsapp eligible returns phone, message and a wa.me url", async () => {
  state.result = { data: { phone: "+5511987654321", message: "Oi, Ana!", actionId: "a" }, error: null };
  const r = await prepareWhatsapp(CART, KEY);
  if (!r.ok || "blocked" in r.data) throw new Error("expected eligible");
  expect(r.data.phone).toBe("+5511987654321");
  expect(r.data.message).toBe("Oi, Ana!");
  expect(r.data.url.startsWith("https://wa.me/5511987654321?text=")).toBe(true);
});

test("confirmSent passes p_repeat and the request key", async () => {
  expect(await confirmSent(CART, KEY, true)).toEqual({ ok: true, data: { repeatRequired: false } });
  expect(state.rpcs).toEqual([["record_cart_action", { p_org: "org", p_cart: CART, p_action: "marked_sent", p_request_key: KEY, p_note: null, p_repeat: true }]]);
});

test("confirmSent translates repeat_confirmation_required", async () => {
  state.result = { data: null, error: { code: "P0001", message: "repeat_confirmation_required" } };
  expect(await confirmSent(CART, KEY, false)).toEqual({ ok: true, data: { repeatRequired: true } });
});

test("confirmSent shows the block reason from the server", async () => {
  state.result = { data: null, error: { code: "P0001", message: "Atendimento pausado" } };
  expect(await confirmSent(CART, KEY, false)).toEqual({ ok: false, error: "Atendimento pausado" });
});

test("recordAction paused without note fails without calling the database", async () => {
  expect(await recordAction(CART, "paused", KEY, "  ")).toEqual({ ok: false, error: "Informe o motivo da pausa." });
  expect(state.rpcs).toHaveLength(0);
});

test("recordAction rejects notes with links", async () => {
  expect((await recordAction(CART, "note", KEY, "veja https://x.com")).ok).toBe(false);
  expect(state.rpcs).toHaveLength(0);
});

test("recordAction sends the trimmed note", async () => {
  expect((await recordAction(CART, "paused", KEY, "  Cliente pediu  ")).ok).toBe(true);
  expect(state.rpcs[0]).toEqual(["record_cart_action", { p_org: "org", p_cart: CART, p_action: "paused", p_request_key: KEY, p_note: "Cliente pediu", p_repeat: false }]);
});

test("savePermission with a future date fails without calling the database", async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  expect((await savePermission(CONTACT, "granted", "Pediu pelo Instagram", future)).ok).toBe(false);
  expect(state.rpcs).toHaveLength(0);
});

test("savePermission sends the validated permission", async () => {
  expect((await savePermission(CONTACT, "granted", "Pediu pelo Instagram", "2026-11-01T12:00:00.000Z")).ok).toBe(true);
  expect(state.rpcs[0]).toEqual(["record_contact_permission", { p_org: "org", p_contact: CONTACT, p_status: "granted", p_source: "Pediu pelo Instagram", p_evidence_at: "2026-11-01T12:00:00.000Z" }]);
});

test("setBlocked requires a reason to block", async () => {
  expect((await setBlocked(CONTACT, true, "")).ok).toBe(false);
  expect(state.rpcs).toHaveLength(0);
  expect((await setBlocked(CONTACT, false, "")).ok).toBe(true);
  expect(state.rpcs[0]).toEqual(["set_contact_blocked", { p_org: "org", p_contact: CONTACT, p_blocked: false, p_reason: null }]);
});

test("saveRecoverySettings normalizes hosts", async () => {
  state.role = "admin";
  const template = "Oi, {primeiro_nome}! {link}";
  expect((await saveRecoverySettings(template, "HTTPS://Seguro.Loja.com/\n\nloja.com.br", true)).ok).toBe(true);
  expect(state.rpcs[0]).toEqual(["save_cart_recovery_settings", { p_org: "org", p_template: template, p_checkout_hosts: ["seguro.loja.com", "loja.com.br"], p_checkout_whatsapp_consent: true }]);
});

test("saveRecoverySettings rejects an invalid host", async () => {
  state.role = "admin";
  expect((await saveRecoverySettings("Oi, {primeiro_nome}! {link}", "não é host", false)).ok).toBe(false);
  expect(state.rpcs).toHaveLength(0);
});

test("saveRecoverySettings is admin only", async () => {
  expect(await saveRecoverySettings("Oi, {primeiro_nome}! {link}", "", false)).toEqual(FORBIDDEN);
  expect(state.rpcs).toHaveLength(0);
});

test("viewer cannot act and the database is not called", async () => {
  state.role = "viewer";
  expect(await prepareWhatsapp(CART, KEY)).toEqual(FORBIDDEN);
  expect(await confirmSent(CART, KEY, false)).toEqual(FORBIDDEN);
  expect(await recordAction(CART, "closed", KEY)).toEqual(FORBIDDEN);
  expect(await savePermission(CONTACT, "granted", "Pediu", "2026-11-01T12:00:00.000Z")).toEqual(FORBIDDEN);
  expect(await setBlocked(CONTACT, false, "")).toEqual(FORBIDDEN);
  expect(state.rpcs).toHaveLength(0);
});
