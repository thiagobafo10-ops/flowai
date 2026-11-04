"use server";
import { z } from "zod";
import { whatsappUrl } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import type { ActionResult } from "@/lib/action-result";

const FORBIDDEN = "Você não tem permissão para esta ação.";
const FAILED = "Não foi possível concluir. Tente novamente.";
const RELOAD = "Recarregue a página e tente novamente.";
const NOTE_RULES = "O texto deve ter de 3 a 240 caracteres, sem links nem dados sensíveis.";
// Mesma regra de nota do record_cart_action.
const NOTE_FORBIDDEN = /[a-z][a-z0-9+.-]*:\/\/|www\.|token|secret|password/i;
const HOST = /^[a-z0-9.-]+\.[a-z]{2,}$/;
const ACTIONS = ["reply_received", "paused", "resumed", "closed", "reopened", "emails_stopped", "note"] as const;
export type CartAction = (typeof ACTIONS)[number];
type Db = Awaited<ReturnType<typeof createServerClient>>;
type DbError = { code?: string; message?: string } | null;

async function operator(minRole: "agent" | "admin") {
  const org = await getActiveOrg();
  const allowed = minRole === "agent" ? ["agent", "admin", "owner"] : ["admin", "owner"];
  if (!org || !allowed.includes(org.role)) return null;
  return { db: await createServerClient(), orgId: org.id };
}

const isId = (v: unknown): v is string => z.uuid().safeParse(v).success;
const textOk = (s: string) => s.length >= 3 && s.length <= 240;

// Respostas do banco nunca chegam cruas à interface; só o motivo de bloqueio (texto fixo do servidor) passa.
function dbError(error: NonNullable<DbError>, passBlockReason = false): string {
  if (error.code === "42501") return FORBIDDEN;
  if (error.message === "open_whatsapp_required") return "Prepare a mensagem e abra o WhatsApp antes de confirmar o envio.";
  if (error.message === "idempotency_conflict") return RELOAD;
  if (error.message === "invalid note") return NOTE_RULES;
  if (passBlockReason && error.code === "P0001" && error.message) return error.message;
  return FAILED;
}

export async function prepareWhatsapp(cartId: string, requestKey: string):
  Promise<ActionResult<{ blocked: string } | { phone: string; message: string; url: string }>> {
  const c = await operator("agent"); if (!c) return { ok: false, error: FORBIDDEN };
  if (!isId(cartId) || !isId(requestKey)) return { ok: false, error: RELOAD };
  const { data, error } = await c.db.rpc("prepare_cart_whatsapp", { p_org: c.orgId, p_cart: cartId, p_request_key: requestKey });
  if (error) return { ok: false, error: dbError(error) };
  const d = data as { blocked?: string; phone?: string; message?: string };
  if (d.blocked) return { ok: true, data: { blocked: d.blocked } };
  if (!d.phone || typeof d.message !== "string") return { ok: false, error: FAILED };
  return { ok: true, data: { phone: d.phone, message: d.message, url: whatsappUrl(d.phone, d.message) } };
}

async function record(c: { db: Db; orgId: string }, cartId: string, action: string, requestKey: string, note: string | null, repeat: boolean) {
  return c.db.rpc("record_cart_action", { p_org: c.orgId, p_cart: cartId, p_action: action, p_request_key: requestKey, p_note: note as string, p_repeat: repeat }); // tipos gerados não marcam nulo, mas o RPC aceita
}

export async function confirmSent(cartId: string, requestKey: string, repeat: boolean): Promise<ActionResult<{ repeatRequired: boolean }>> {
  const c = await operator("agent"); if (!c) return { ok: false, error: FORBIDDEN };
  if (!isId(cartId) || !isId(requestKey)) return { ok: false, error: RELOAD };
  const { error } = await record(c, cartId, "marked_sent", requestKey, null, repeat === true);
  if (error?.message === "repeat_confirmation_required") return { ok: true, data: { repeatRequired: true } };
  if (error) return { ok: false, error: dbError(error, true) };
  return { ok: true, data: { repeatRequired: false } };
}

export async function recordAction(cartId: string, action: CartAction, requestKey: string, note?: string): Promise<ActionResult> {
  const c = await operator("agent"); if (!c) return { ok: false, error: FORBIDDEN };
  if (!isId(cartId) || !isId(requestKey) || !ACTIONS.includes(action)) return { ok: false, error: RELOAD };
  const text = (note ?? "").trim() || null;
  if (!text && action === "paused") return { ok: false, error: "Informe o motivo da pausa." };
  if (!text && action === "note") return { ok: false, error: "Escreva a observação." };
  if (text && (!textOk(text) || NOTE_FORBIDDEN.test(text))) return { ok: false, error: NOTE_RULES };
  const { error } = await record(c, cartId, action, requestKey, text, false);
  return error ? { ok: false, error: dbError(error) } : { ok: true, data: undefined };
}

export async function savePermission(contactId: string, status: "granted" | "revoked", source: string, evidenceAt: string): Promise<ActionResult> {
  const c = await operator("agent"); if (!c) return { ok: false, error: FORBIDDEN };
  if (!isId(contactId)) return { ok: false, error: RELOAD };
  if (status !== "granted" && status !== "revoked") return { ok: false, error: "Escolha a situação da autorização." };
  const src = (source ?? "").trim();
  if (!textOk(src)) return { ok: false, error: "Informe a origem (3 a 240 caracteres)." };
  const at = Date.parse(evidenceAt);
  if (Number.isNaN(at)) return { ok: false, error: "Informe a data da evidência." };
  if (at > Date.now()) return { ok: false, error: "A data da evidência não pode estar no futuro." };
  const { error } = await c.db.rpc("record_contact_permission", {
    p_org: c.orgId, p_contact: contactId, p_status: status, p_source: src, p_evidence_at: new Date(at).toISOString(),
  });
  return error ? { ok: false, error: dbError(error) } : { ok: true, data: undefined };
}

export async function setBlocked(contactId: string, blocked: boolean, reason: string): Promise<ActionResult> {
  const c = await operator("agent"); if (!c) return { ok: false, error: FORBIDDEN };
  if (!isId(contactId)) return { ok: false, error: RELOAD };
  const why = (reason ?? "").trim();
  if (blocked && !textOk(why)) return { ok: false, error: "Informe o motivo do bloqueio (3 a 240 caracteres)." };
  const { error } = await c.db.rpc("set_contact_blocked", { p_org: c.orgId, p_contact: contactId, p_blocked: blocked === true, p_reason: (blocked ? why : null) as string }); // nulo aceito pelo RPC ao desbloquear
  return error ? { ok: false, error: dbError(error) } : { ok: true, data: undefined };
}

/** Mesma normalização do save_cart_recovery_settings: minúsculo, sem esquema, caminho, consulta nem ponto final. */
function normalizeHost(raw: string): string {
  const noScheme = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  return noScheme.split("/")[0].split("?")[0].split("#")[0].replace(/\.+$/, "");
}

export async function saveRecoverySettings(template: string, hosts: string, checkoutConsent: boolean): Promise<ActionResult> {
  const c = await operator("admin"); if (!c) return { ok: false, error: FORBIDDEN };
  const tpl = (template ?? "").trim();
  if (tpl.length < 10 || tpl.length > 2000) return { ok: false, error: "O modelo deve ter de 10 a 2000 caracteres." };
  const list = [...new Set((hosts ?? "").split(/\r?\n/).map(normalizeHost).filter(Boolean))];
  const bad = list.find((h) => !HOST.test(h));
  if (bad) return { ok: false, error: `Host inválido: ${bad}` };
  const { error } = await c.db.rpc("save_cart_recovery_settings", { p_org: c.orgId, p_template: tpl, p_checkout_hosts: list, p_checkout_whatsapp_consent: checkoutConsent === true });
  if (error?.message === "store connection required") return { ok: false, error: "Conecte a loja Yampi antes de cadastrar hosts." };
  return error ? { ok: false, error: dbError(error) } : { ok: true, data: undefined };
}
