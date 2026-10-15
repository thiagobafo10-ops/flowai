"use server";
import { z } from "zod";
import { vipSettingsSchema, vipErrorMessage } from "./vip";
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

async function ownedInstagramChannel(c: NonNullable<Awaited<ReturnType<typeof admin>>>, id: string) {
  const result = await c.db.from("channels").select("id,status,meta_connection_id").eq("id", id).eq("organization_id", c.orgId).eq("type", "instagram").maybeSingle();
  return result.error ? null : result.data;
}
export async function saveInstagramVipSettings(input: unknown): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  const parsed = vipSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Informe uma resposta curta e um link de convite válido do WhatsApp." };
  const channel = await ownedInstagramChannel(c, parsed.data.channelId);
  if (!channel) return { ok: false, error: FORBIDDEN };
  if (parsed.data.enabled && channel.status !== "active") return { ok: false, error: vipErrorMessage("connection_disconnected") };
  const { error } = await c.db.rpc("save_instagram_vip_settings", { p_channel_id: channel.id, p_enabled: parsed.data.enabled, p_public_reply_text: parsed.data.publicReplyText, p_group_url: parsed.data.groupUrl });
  return error ? { ok: false, error: vipErrorMessage(parsed.data.enabled && error.code === "22023" ? "comments_permission_required" : error.message) } : { ok: true, data: undefined };
}
export async function verifyInstagramVipPermission(channelId: string): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  if (!z.uuid().safeParse(channelId).success) return { ok: false, error: "Canal inválido." };
  const channel = await ownedInstagramChannel(c, channelId);
  if (!channel) return { ok: false, error: FORBIDDEN };
  if (channel.status !== "active" || !channel.meta_connection_id) return { ok: false, error: vipErrorMessage("connection_disconnected") };
  const result = await invoke(c, { action: "verify_vip", channelId, connectionId: channel.meta_connection_id });
  return result.ok && result.data.verified === true ? { ok: true, data: undefined } : result.ok ? { ok: false, error: vipErrorMessage("comments_permission_required") } : result;
}
