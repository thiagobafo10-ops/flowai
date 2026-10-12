import { z } from "zod";
import { type ChannelType, type InboxTab } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";
import { listMembers } from "@/lib/crm/queries";

export type ChannelRow = {
  id: string;
  type: ChannelType;
  name: string;
  status: "needs_setup" | "active" | "error";
};

/** Colunas explícitas: segredos e tokens do canal nunca saem do banco. */
export async function listChannels(orgId: string): Promise<ChannelRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("channels")
    .select("id, type, name, status")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as ChannelRow[];
}

export const PAGE_SIZE = 50;

export type ConversationStatus = "open" | "pending_human" | "closed";

export type ConversationListItem = {
  id: string;
  contact: { id: string; name: string | null; phone: string | null; email: string | null };
  channel: { id: string; type: ChannelType };
  status: ConversationStatus;
  handledBy: "ai" | "human";
  assignedTo: { userId: string; name: string } | null;
  lastMessageAt: string;
  preview: { text: string; fromTeam: boolean } | null;
  lastInboundAt: string | null;
  lastReadAt: string | null;
};

export type MessageItem = {
  id: string;
  direction: "inbound" | "outbound";
  senderType: "contact" | "ai" | "human" | "system" | "automation";
  senderName: string | null;
  senderUserId: string | null;
  text: string;
  isInternalNote: boolean;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
  createdAt: string;
  context?: { origin?: string; storyId?: string; commentId?: string };
};

export type ConversationDetail = Omit<ConversationListItem, "preview" | "lastInboundAt" | "channel"> & {
  channel: { id: string; type: ChannelType; name: string };
  /** Última mensagem recebida do contato (abre a janela de 24h do Instagram). */
  lastInboundAt: string | null;
  closedAt: string | null;
  intent: string | null;
  sentiment: string | null;
  summary: string | null;
};

const CONVERSATION_COLUMNS =
  "id, status, handled_by, assigned_to, last_message_at, last_read_at, closed_at, intent, sentiment, summary, " +
  "contacts(id, name, phone, email), channels(id, type, name)";

type ConversationRow = {
  id: string;
  status: ConversationStatus;
  handled_by: "ai" | "human";
  assigned_to: string | null;
  last_message_at: string;
  last_read_at: string | null;
  closed_at: string | null;
  intent: string | null;
  sentiment: string | null;
  summary: string | null;
  contacts: { id: string; name: string | null; phone: string | null; email: string | null } | null;
  channels: { id: string; type: ChannelType; name: string } | null;
};

/** The timestamp is kept verbatim: Date would discard PostgreSQL microseconds. */
function parseCursor(value?: string): { at: string; id: string | null } | null {
  if (!value) return null;
  const [at, id, extra] = value.split("|");
  if (extra !== undefined || Number.isNaN(Date.parse(at)) || (id !== undefined && !z.uuid().safeParse(id).success)) return null;
  return { at, id: id ?? null };
}

async function memberNames(orgId: string): Promise<Map<string, string>> {
  return new Map((await listMembers(orgId)).map((m) => [m.userId, m.name]));
}

export async function listConversations(
  orgId: string,
  opts: { tab: InboxTab; q: string; channelId: string | null; cursor?: string },
): Promise<{ items: ConversationListItem[]; nextCursor: string | null; counts: Record<InboxTab, number> }> {
  const supabase = await createServerClient();
  const cursor = parseCursor(opts.cursor);
  const [list, count] = await Promise.all([
    supabase.rpc("list_inbox", {
      p_org: orgId, p_tab: opts.tab, p_q: opts.q.trim(), p_channel: opts.channelId!,
      p_cursor_at: cursor?.at ?? null!, p_cursor_id: cursor?.id ?? null!, p_limit: PAGE_SIZE + 1,
    }),
    supabase.rpc("inbox_counts", { p_org: orgId }),
  ]);
  if (list.error) throw list.error;
  if (count.error) throw count.error;
  const rows = list.data ?? [];
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.id, contact: { id: r.contact_id, name: r.contact_name, phone: r.contact_phone, email: r.contact_email },
      channel: { id: r.channel_id, type: r.channel_type }, status: r.status, handledBy: r.handled_by,
      assignedTo: r.assigned_to ? { userId: r.assigned_to, name: r.assignee_name ?? "Sem nome" } : null,
      lastMessageAt: r.last_message_at, lastReadAt: r.last_read_at,
      preview: r.preview === null ? null : { text: r.preview, fromTeam: r.preview_from_team },
      lastInboundAt: r.last_inbound_at,
    })),
    nextCursor: rows.length > PAGE_SIZE && last ? last.last_message_at + "|" + last.id : null,
    counts: count.data as Record<InboxTab, number>,
  };
}

export async function getConversation(
  orgId: string,
  id: string,
  before?: string,
): Promise<{ conversation: ConversationDetail; messages: MessageItem[]; hasMore: boolean } | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  const r = data as unknown as ConversationRow | null;
  if (!r || !r.contacts || !r.channels) return null;

  let query = supabase
    .from("messages")
    .select("id, direction, sender_type, sender_user_id, content, is_internal_note, status, error, created_at, context")
    .eq("organization_id", orgId)
    .eq("conversation_id", id);
  const cursor = parseCursor(before);
  if (cursor?.id) {
    // Validated UUID and timestamp; JSON quoting protects PostgREST filter syntax.
    query = query.or(`created_at.lt.${JSON.stringify(cursor.at)},and(created_at.eq.${JSON.stringify(cursor.at)},id.lt.${cursor.id})`);
  } else if (cursor) {
    query = query.lt("created_at", cursor.at);
  }
  const [{ data: msgs, error: msgError }, members, { data: inbound, error: inboundError }] = await Promise.all([
    query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE + 1),
    memberNames(orgId),
    supabase.from("messages").select("created_at").eq("organization_id", orgId).eq("conversation_id", id)
      .eq("direction", "inbound").eq("sender_type", "contact").order("created_at", { ascending: false }).limit(1),
  ]);
  if (msgError) throw msgError;
  if (inboundError) throw inboundError;

  const messages: MessageItem[] = msgs
    .slice(0, PAGE_SIZE)
    .reverse()
    .map((m) => ({
      id: m.id,
      direction: m.direction,
      senderType: m.sender_type,
      senderUserId: m.sender_user_id,
      senderName: m.sender_type === "human" && m.sender_user_id ? (members.get(m.sender_user_id) ?? null) : null,
      text: m.content,
      isInternalNote: m.is_internal_note,
      status: m.status,
      error: m.error,
      createdAt: m.created_at,
      context: m.context as MessageItem["context"],
    }));

  return {
    conversation: {
      id: r.id,
      contact: r.contacts,
      channel: r.channels,
      status: r.status,
      handledBy: r.handled_by,
      assignedTo: r.assigned_to ? { userId: r.assigned_to, name: members.get(r.assigned_to) ?? "Sem nome" } : null,
      lastMessageAt: r.last_message_at,
      lastReadAt: r.last_read_at,
      closedAt: r.closed_at,
      lastInboundAt: inbound[0]?.created_at ?? null,
      intent: r.intent,
      sentiment: r.sentiment,
      summary: r.summary,
    },
    messages,
    hasMore: msgs.length > PAGE_SIZE,
  };
}
