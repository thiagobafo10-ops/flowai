"use server";
import { z } from "zod";
import { instagramVersionSchema, instagramIdSchema } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import type { ActionResult } from "@/lib/action-result";
import { instagramActionMessage as message } from "./messages";

const FORBIDDEN = "Você não tem permissão para esta ação.";
async function admin() {
  const org = await getActiveOrg();
  if (!org || !["owner", "admin"].includes(org.role)) return null;
  const db = await createServerClient();
  const { data: { user } } = await db.auth.getUser();
  return user ? { db, orgId: org.id } : null;
}
async function invoke(c: NonNullable<Awaited<ReturnType<typeof admin>>>, body: Record<string, unknown>): Promise<ActionResult<Record<string, unknown>>> {
  const { data: { session } } = await c.db.auth.getSession();
  if (!session) return { ok: false, error: FORBIDDEN };
  const { data, error } = await c.db.functions.invoke("meta-connection", { body: { organizationId: c.orgId, ...body }, headers: { Authorization: `Bearer ${session.access_token}` } });
  if (error) {
    let code: unknown;
    try { if (error.context instanceof Response) code = (await error.context.clone().json()).error; } catch { /* safe generic response */ }
    return { ok: false, error: message(code) };
  }
  if (data?.error) return { ok: false, error: message(data.error) };
  return { ok: true, data: data ?? {} };
}
const connectionSchema = z.object({ name: z.string().trim().min(1).max(100), appId: instagramIdSchema, accountId: instagramIdSchema, apiVersion: instagramVersionSchema, appSecret: z.string().min(1).max(8192), accessToken: z.string().min(1).max(8192), connectionId: z.uuid().optional() });
export async function saveInstagramConnection(input: unknown): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  const parsed = connectionSchema.safeParse(input); if (!parsed.success) return { ok: false, error: "Preencha os IDs, a versão e as credenciais do Instagram." };
  const result = await invoke(c, { action: "save", input: parsed.data });
  return result.ok ? { ok: true, data: undefined } : result;
}
export async function testInstagramConnection(id: string): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Conexão inválida." };
  const result = await invoke(c, { action: "test", connectionId: id }); return result.ok ? { ok: true, data: undefined } : result;
}
export async function disconnectInstagramConnection(id: string): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Conexão inválida." };
  const result = await invoke(c, { action: "disconnect", connectionId: id }); return result.ok ? { ok: true, data: undefined } : result;
}
export async function removeInstagramConnection(id: string): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Conexão inválida." };
  const result = await invoke(c, { action: "remove", connectionId: id }); return result.ok ? { ok: true, data: undefined } : result;
}
export async function revealInstagramVerifyToken(id: string): Promise<ActionResult<{ token: string }>> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Conexão inválida." };
  const result = await invoke(c, { action: "reveal_verify_token", connectionId: id });
  return result.ok && typeof result.data.verifyToken === "string" ? { ok: true, data: { token: result.data.verifyToken } } : result.ok ? { ok: false, error: "Não foi possível obter o verify token." } : result;
}
// A tela de Canais não chama mais estas ações (regras de comentário viraram automações); elas continuam
// respondendo com o aviso para clientes antigos ainda abertos.
const RULES_MOVED = "As regras de comentário agora são automações.";
export async function saveCommentRule(input: unknown): Promise<ActionResult> {
  void input;
  return { ok: false, error: RULES_MOVED };
}
export async function setCommentRuleActive(id: string, active: boolean): Promise<ActionResult> {
  void id; void active;
  return { ok: false, error: RULES_MOVED };
}
