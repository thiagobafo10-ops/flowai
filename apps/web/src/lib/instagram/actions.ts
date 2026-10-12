"use server";
import { z } from "zod";
import { instagramTextSchema, instagramVersionSchema, instagramIdSchema } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import type { ActionResult } from "@/lib/action-result";

const FORBIDDEN = "Você não tem permissão para esta ação.";
async function admin() {
  const org = await getActiveOrg();
  if (!org || !["owner", "admin"].includes(org.role)) return null;
  const db = await createServerClient();
  const { data: { user } } = await db.auth.getUser();
  return user ? { db, orgId: org.id } : null;
}
function message(code: unknown) {
  return code === "invalid_token" ? "O token do Instagram é inválido ou expirou." : code === "permission_denied" ? "Confira as permissões de mensagens e comentários no app Meta." : code === "invalid_account" ? "O token pertence a outra conta do Instagram." : code === "media_not_owned" ? "Esse post não pertence à conta conectada." : code === "already_connected" ? "Esse app Meta já possui uma conexão." : code === "credentials_changed" ? "As credenciais mudaram. Teste novamente." : "Não foi possível concluir a configuração do Instagram.";
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
export async function revealInstagramVerifyToken(id: string): Promise<ActionResult<{ token: string }>> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Conexão inválida." };
  const result = await invoke(c, { action: "reveal_verify_token", connectionId: id });
  return result.ok && typeof result.data.verifyToken === "string" ? { ok: true, data: { token: result.data.verifyToken } } : result.ok ? { ok: false, error: "Não foi possível obter o verify token." } : result;
}
const ruleSchema = z.object({ id: z.uuid().optional(), channelId: z.uuid(), keyword: z.string().trim().min(1).max(100), replyText: instagramTextSchema, mediaId: instagramIdSchema.nullable(), active: z.boolean() });
export async function saveCommentRule(input: unknown): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  const parsed = ruleSchema.safeParse(input); if (!parsed.success) return { ok: false, error: "Preencha a palavra-chave e uma resposta com até 1.000 bytes." };
  const { data: channel } = await c.db.from("channels").select("id,meta_connection_id").eq("organization_id", c.orgId).eq("id", parsed.data.channelId).eq("type", "instagram").maybeSingle();
  if (!channel?.meta_connection_id) return { ok: false, error: FORBIDDEN };
  let disablingUnchangedMedia = false;
  if (parsed.data.id && !parsed.data.active) {
    const { data: original } = await c.db.from("instagram_comment_rules").select("media_id,channel_id").eq("organization_id", c.orgId).eq("id", parsed.data.id).maybeSingle();
    disablingUnchangedMedia = original?.channel_id === channel.id && original.media_id === parsed.data.mediaId;
  }
  if (parsed.data.mediaId && !disablingUnchangedMedia) {
    const verified = await invoke(c, { action: "validate_media", connectionId: channel.meta_connection_id, channelId: channel.id, mediaId: parsed.data.mediaId });
    if (!verified.ok) return verified;
  }
  const { error } = await c.db.rpc("save_instagram_comment_rule", { p_input: parsed.data });
  return error ? { ok: false, error: error.code === "42501" ? FORBIDDEN : "Não foi possível salvar. Confira o canal e o post selecionado." } : { ok: true, data: undefined };
}
export async function setCommentRuleActive(id: string, active: boolean): Promise<ActionResult> {
  const c = await admin(); if (!c) return { ok: false, error: FORBIDDEN };
  if (!z.uuid().safeParse(id).success || typeof active !== "boolean") return { ok: false, error: "Regra inválida." };
  const { data: rule } = await c.db.from("instagram_comment_rules").select("id,channel_id,keyword,reply_text,media_id").eq("organization_id", c.orgId).eq("id", id).maybeSingle();
  if (!rule) return { ok: false, error: FORBIDDEN };
  return saveCommentRule({ id: rule.id, channelId: rule.channel_id, keyword: rule.keyword, replyText: rule.reply_text, mediaId: rule.media_id, active });
}
