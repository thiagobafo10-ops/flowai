"use server";

import { z } from "zod";
import { providerFor, replySchema, type ChannelType } from "@flowai/core";
import type { ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";

const MSG_FORBIDDEN = "Você não tem permissão para esta ação.";
const MSG_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
const MSG_GONE = "Esta conversa não existe mais.";
const MSG_CLOSED = "Reabra a conversa para responder.";
const MSG_MESSAGE_GONE = "Esta mensagem não existe mais.";
const MSG_SEND_FAILED = "Não foi possível enviar a mensagem.";
const MSG_ASSIGNEE_GONE = "O responsável não existe mais.";
const WRITE_ROLES = ["agent", "admin", "owner"];

type Supabase = Awaited<ReturnType<typeof createServerClient>>;
type Fail = { ok: false; error: string };
type Ctx = { orgId: string; userId: string; supabase: Supabase };

function dbError(context: string, error: { code?: string }): Fail {
  if (error.code === "42501") return { ok: false, error: MSG_FORBIDDEN };
  console.error(context, error);
  return { ok: false, error: MSG_UNEXPECTED };
}

/** Sessão + papel (agent+ quando `write`); qualquer membro caso contrário. */
async function context(write: boolean): Promise<Ctx | Fail> {
  const org = await getActiveOrg();
  if (!org || (write && !WRITE_ROLES.includes(org.role))) return { ok: false, error: MSG_FORBIDDEN };
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: MSG_FORBIDDEN };
  return { orgId: org.id, userId: user.id, supabase };
}

const isFail = (v: Ctx | Fail): v is Fail => "ok" in v;

type ConversationInfo = {
  id: string;
  status: "open" | "pending_human" | "closed";
  channel_id: string;
  channels: { type: ChannelType } | null;
  contacts: { phone: string | null; whatsapp_id: string | null; instagram_id: string | null } | null;
};

async function loadConversation(c: Ctx, id: string): Promise<ConversationInfo | Fail> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: MSG_GONE };
  const { data, error } = await c.supabase
    .from("conversations")
    .select("id, status, channel_id, channels(type), contacts(phone, whatsapp_id, instagram_id)")
    .eq("organization_id", c.orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return dbError("load conversation failed", error);
  if (!data) return { ok: false, error: MSG_GONE };
  return data as unknown as ConversationInfo;
}

const isFailInfo = (v: ConversationInfo | Fail): v is Fail => "ok" in v;

function parseText(text: string): ActionResult<string> {
  const parsed = replySchema.safeParse({ text });
  if (parsed.success) return { ok: true, data: parsed.data.text };
  const message = parsed.error.issues[0]?.message ?? MSG_UNEXPECTED;
  return { ok: false, error: message, fieldErrors: { text: [message] } };
}

/** Envia pelo provedor e grava o resultado. A mensagem pending já existe. */
async function deliver(
  c: Ctx,
  conv: ConversationInfo,
  messageId: string,
  text: string,
): Promise<ActionResult<{ messageId: string }>> {
  const type = conv.channels?.type;
  let failure: string | null = null;
  try {
    if (!type) throw new Error("Canal não encontrado.");
    const to = conv.contacts?.whatsapp_id ?? conv.contacts?.phone ?? conv.contacts?.instagram_id ?? "";
    // O external_id devolvido não é gravável pelo app (sem grant): só o status.
    await providerFor(type).sendMessage({ externalId: to }, { text });
  } catch (err) {
    failure = err instanceof Error ? err.message : "Falha no envio.";
  }
  const { data, error } = await c.supabase
    .from("messages")
    .update(failure === null ? { status: type === "simulator" ? "delivered" : "sent", error: null } : { status: "failed", error: failure })
    .eq("organization_id", c.orgId)
    .eq("id", messageId)
    .select("id");
  if (error || data.length === 0) {
    console.error("update message status failed", error);
    return { ok: false, error: MSG_UNEXPECTED };
  }
  if (failure !== null) {
    console.error("send message failed", failure);
    return { ok: false, error: MSG_SEND_FAILED };
  }
  return { ok: true, data: { messageId } };
}

async function insertMessage(
  c: Ctx,
  conv: ConversationInfo,
  text: string,
  internal: boolean,
): Promise<ActionResult<{ messageId: string }>> {
  const { data, error } = await c.supabase
    .from("messages")
    .insert({
      organization_id: c.orgId,
      conversation_id: conv.id,
      channel_id: conv.channel_id,
      direction: "outbound",
      sender_type: "human",
      sender_user_id: c.userId,
      content: text,
      content_type: "text",
      is_internal_note: internal,
      ...(internal ? { status: "delivered" as const } : {}),
    })
    .select("id")
    .single();
  if (error) return dbError("insert message failed", error);
  return { ok: true, data: { messageId: data.id } };
}

export async function sendReply(conversationId: string, text: string): Promise<ActionResult<{ messageId: string }>> {
  const c = await context(true);
  if (isFail(c)) return c;
  const parsed = parseText(text);
  if (!parsed.ok) return parsed;
  const conv = await loadConversation(c, conversationId);
  if (isFailInfo(conv)) return conv;
  if (conv.status === "closed") return { ok: false, error: MSG_CLOSED };
  const inserted = await insertMessage(c, conv, parsed.data, false);
  if (!inserted.ok) return inserted;
  return deliver(c, conv, inserted.data.messageId, parsed.data);
}

export async function retryMessage(messageId: string): Promise<ActionResult<{ messageId: string }>> {
  const c = await context(true);
  if (isFail(c)) return c;
  if (!z.uuid().safeParse(messageId).success) return { ok: false, error: MSG_MESSAGE_GONE };
  const { data: msg, error } = await c.supabase
    .from("messages")
    .select("id, conversation_id, content")
    .eq("organization_id", c.orgId)
    .eq("id", messageId)
    .eq("direction", "outbound")
    .eq("sender_type", "human")
    .eq("sender_user_id", c.userId)
    .eq("is_internal_note", false)
    .eq("status", "failed")
    .maybeSingle();
  if (error) return dbError("load message failed", error);
  if (!msg) return { ok: false, error: MSG_MESSAGE_GONE };
  const conv = await loadConversation(c, msg.conversation_id);
  if (isFailInfo(conv)) return conv;
  if (conv.status === "closed") return { ok: false, error: MSG_CLOSED };
  const { data: reset, error: resetError } = await c.supabase
    .from("messages")
    .update({ status: "pending", error: null })
    .eq("organization_id", c.orgId)
    .eq("id", messageId)
    .eq("status", "failed")
    .select("id");
  if (resetError) return dbError("reset message failed", resetError);
  if (reset.length === 0) return { ok: false, error: MSG_MESSAGE_GONE };
  return deliver(c, conv, messageId, msg.content);
}

export async function addInternalNote(
  conversationId: string,
  text: string,
): Promise<ActionResult<{ messageId: string }>> {
  const c = await context(true);
  if (isFail(c)) return c;
  const parsed = parseText(text);
  if (!parsed.ok) return parsed;
  const conv = await loadConversation(c, conversationId);
  if (isFailInfo(conv)) return conv;
  return insertMessage(c, conv, parsed.data, true);
}

type SystemKind = "assumed" | "assigned" | "unassigned" | "closed" | "reopened";

/** Mensagem de sistema do histórico. O estado já mudou: falha aqui é registrada, não desfaz. */
async function logSystem(c: Ctx, conversationId: string, kind: SystemKind, target?: string): Promise<void> {
  const { error } = await c.supabase.rpc("log_conversation_system_message", {
    p_conversation: conversationId,
    p_kind: kind,
    ...(target ? { p_target_user: target } : {}),
  });
  if (error) console.error("log system message failed", error);
}

async function updateConversation(
  c: Ctx,
  id: string,
  patch: { status?: "open" | "pending_human" | "closed"; handled_by?: "human"; assigned_to?: string | null },
): Promise<ActionResult> {
  const { data, error } = await c.supabase
    .from("conversations")
    .update(patch)
    .eq("organization_id", c.orgId)
    .eq("id", id)
    .select("id");
  if (error) return dbError("update conversation failed", error);
  if (data.length === 0) return { ok: false, error: MSG_GONE };
  return { ok: true, data: undefined };
}

export async function takeOver(conversationId: string): Promise<ActionResult> {
  const c = await context(true);
  if (isFail(c)) return c;
  const conv = await loadConversation(c, conversationId);
  if (isFailInfo(conv)) return conv;
  if (conv.status === "closed") return { ok: false, error: MSG_CLOSED };
  const updated = await updateConversation(c, conv.id, {
    assigned_to: c.userId,
    handled_by: "human",
    ...(conv.status === "pending_human" ? { status: "open" as const } : {}),
  });
  if (!updated.ok) return updated;
  await logSystem(c, conv.id, "assumed");
  return { ok: true, data: undefined };
}

export async function assignConversation(
  conversationId: string,
  userId: string | null,
  note?: string,
): Promise<ActionResult> {
  const c = await context(true);
  if (isFail(c)) return c;
  if (userId !== null && !z.uuid().safeParse(userId).success) return { ok: false, error: MSG_ASSIGNEE_GONE };
  let noteText: string | null = null;
  if (note !== undefined && note.trim() !== "") {
    const parsed = parseText(note);
    if (!parsed.ok) return parsed;
    noteText = parsed.data;
  }
  const conv = await loadConversation(c, conversationId);
  if (isFailInfo(conv)) return conv;
  if (conv.status === "closed") return { ok: false, error: MSG_CLOSED };

  if (userId !== null) {
    const { data: member, error } = await c.supabase
      .from("memberships")
      .select("user_id")
      .eq("organization_id", c.orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return dbError("assignee lookup failed", error);
    if (!member) return { ok: false, error: MSG_ASSIGNEE_GONE };
  }

  const updated = await updateConversation(
    c,
    conv.id,
    userId === null
      ? { assigned_to: null }
      : {
          assigned_to: userId,
          handled_by: "human",
          ...(conv.status === "pending_human" ? { status: "open" as const } : {}),
        },
  );
  if (!updated.ok) return updated;
  await logSystem(c, conv.id, userId === null ? "unassigned" : "assigned", userId ?? undefined);
  if (noteText !== null) {
    const inserted = await insertMessage(c, conv, noteText, true);
    if (!inserted.ok) return inserted;
  }
  return { ok: true, data: undefined };
}

async function setClosed(conversationId: string, close: boolean): Promise<ActionResult> {
  const c = await context(true);
  if (isFail(c)) return c;
  const conv = await loadConversation(c, conversationId);
  if (isFailInfo(conv)) return conv;
  const updated = await updateConversation(c, conv.id, { status: close ? "closed" : "open" });
  if (!updated.ok) return updated;
  await logSystem(c, conv.id, close ? "closed" : "reopened");
  return { ok: true, data: undefined };
}

export async function closeConversation(id: string): Promise<ActionResult> {
  return setClosed(id, true);
}

export async function reopenConversation(id: string): Promise<ActionResult> {
  return setClosed(id, false);
}

export async function markRead(id: string): Promise<ActionResult> {
  const c = await context(false);
  if (isFail(c)) return c;
  if (!z.uuid().safeParse(id).success) return { ok: false, error: MSG_GONE };
  const { error } = await c.supabase.rpc("mark_conversation_read", { p_conversation: id });
  if (error) {
    // A função devolve 42501 tanto para conversa inexistente quanto de outra org.
    if (error.code === "42501") return { ok: false, error: MSG_GONE };
    return dbError("mark read failed", error);
  }
  return { ok: true, data: undefined };
}
