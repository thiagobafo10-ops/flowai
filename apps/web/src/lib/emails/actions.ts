"use server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import type { ActionResult } from "@/lib/action-result";
import { settingsSchema, stepSchema, storeConnectionSchema } from "./schemas";

const FORBIDDEN = "Você não tem permissão para esta ação.";
const SAVE_FAILED = "Não foi possível salvar. Tente novamente.";
// Textos fixos por código do email-admin: respostas do servidor nunca chegam cruas à interface.
const ADMIN_ERRORS: Record<string, string> = {
  no_settings: "Salve a chave do Resend antes.",
  provider_unavailable: "O Resend não respondeu. Confira a chave e tente novamente.",
  no_email: "Sua conta não tem e-mail para receber o teste.",
  not_found: "Passo não encontrado.",
  forbidden: FORBIDDEN,
};
const adminError = (code: unknown) =>
  (typeof code === "string" && Object.hasOwn(ADMIN_ERRORS, code) ? ADMIN_ERRORS[code] : undefined) ?? "Não foi possível concluir. Tente novamente.";

async function admin() {
  const org = await getActiveOrg();
  if (!org || !["owner", "admin"].includes(org.role)) return null;
  const db = await createServerClient();
  const { data: { user } } = await db.auth.getUser();
  return user ? { db, orgId: org.id } : null;
}
type Admin = NonNullable<Awaited<ReturnType<typeof admin>>>;

function invalid(error: z.ZodError): ActionResult<never> {
  return { ok: false, error: error.issues[0]?.message ?? "Dados inválidos.", fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]> };
}
const done = (error: unknown): ActionResult => (error ? { ok: false, error: SAVE_FAILED } : { ok: true, data: undefined });

async function invoke(c: Admin, body: Record<string, unknown>): Promise<ActionResult<Record<string, unknown>>> {
  const { data: { session } } = await c.db.auth.getSession();
  if (!session) return { ok: false, error: FORBIDDEN };
  const { data, error } = await c.db.functions.invoke("email-admin", { body: { organizationId: c.orgId, ...body }, headers: { Authorization: `Bearer ${session.access_token}` } });
  if (error) {
    let code: unknown;
    try { if (error.context instanceof Response) code = (await error.context.clone().json()).error; } catch { /* resposta genérica */ }
    return { ok: false, error: adminError(code) };
  }
  if (data?.error) return { ok: false, error: adminError(data.error) };
  return { ok: true, data: data ?? {} };
}

export async function saveStoreConnection(input: unknown): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  const parsed = storeConnectionSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  const { error } = await c.db.rpc("save_store_connection", { p_org: c.orgId, p_alias: parsed.data.alias, p_secret: parsed.data.secret });
  return done(error);
}

export async function setCartJourneyEnabled(enabled: boolean): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  const { error } = await c.db.rpc("set_email_journey_enabled", { p_org: c.orgId, p_kind: "cart", p_enabled: enabled === true });
  return done(error);
}

export async function saveStep(stepId: string, input: unknown): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  if (!z.uuid().safeParse(stepId).success) return { ok: false, error: "Passo não encontrado." };
  const parsed = stepSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  const { error } = await c.db.rpc("save_email_journey_step", { p_org: c.orgId, p_step: stepId, p_input: parsed.data });
  return done(error);
}

export async function saveSettings(input: unknown): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  const parsed = settingsSchema.safeParse(input); if (!parsed.success) return invalid(parsed.error);
  const { resendKey, resendWebhookSecret, ...rest } = parsed.data;
  // Os ids dos segredos não são legíveis: a tela só mostra "configurada" porque o primeiro salvamento exige os dois.
  if (!resendKey || !resendWebhookSecret) {
    const current = await c.db.from("email_settings").select("organization_id").eq("organization_id", c.orgId).maybeSingle();
    if (current.error) return { ok: false, error: SAVE_FAILED };
    if (!current.data) return { ok: false, error: "Informe a chave do Resend e o segredo do webhook." };
  }
  // Campo vazio não é enviado: o RPC mantém o segredo atual.
  const p_input = { ...rest, ...(resendKey ? { resendKey } : {}), ...(resendWebhookSecret ? { resendWebhookSecret } : {}) };
  const { error } = await c.db.rpc("save_email_settings", { p_org: c.orgId, p_input });
  return done(error);
}

export async function sendTestEmail(stepId: string): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  if (!z.uuid().safeParse(stepId).success) return { ok: false, error: "Passo não encontrado." };
  const result = await invoke(c, { action: "test", stepId });
  return result.ok ? { ok: true, data: undefined } : result;
}

export async function verifyDomain(): Promise<ActionResult<{ status: string }>> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  const result = await invoke(c, { action: "verify_domain" });
  if (!result.ok) return result;
  return typeof result.data.status === "string" ? { ok: true, data: { status: result.data.status } } : { ok: false, error: adminError(null) };
}
