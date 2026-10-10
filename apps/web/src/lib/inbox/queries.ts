import { z } from "zod";
import { INBOX_TABS, type ChannelType, type InboxTab } from "@flowai/core";
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
const NO_USER = "00000000-0000-0000-0000-000000000000";

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
  text: string;
  isInternalNote: boolean;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
  createdAt: string;
};

export type ConversationDetail = Omit<ConversationListItem, "preview" | "lastInboundAt" | "channel"> & {
  channel: { id: string; type: ChannelType; name: string };
  closedAt: string | null;
  intent: string | null;
  sentiment: string | null;
  summary: string | null;
};

const CONVERSATION_COLUMNS =
  "id, status, handled_by, assigned_to, last_message_at, last_read_at, closed_at, intent, sentiment, summary, " +
  "contacts(id, name, phone, email), channels(id, type, name)";

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

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

type MessageRow = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  sender_type: MessageItem["senderType"];
  content: string;
  created_at: string;
};

/** Filtros de cada aba (spec §3.2) como pares coluna/valor. */
function tabFilters(tab: InboxTab, userId: string | null) {
  const f = { eq: [] as [string, string][], neq: [] as [string, string][], isNull: [] as string[] };
  switch (tab) {
    case "minhas":
      f.eq.push(["assigned_to", userId ?? NO_USER]);
      f.neq.push(["status", "closed"]);
      break;
    case "nao-atribuidas":
      f.isNull.push("assigned_to");
      f.eq.push(["status", "open"]);
      break;
    case "aguardando":
      f.eq.push(["status", "pending_human"]);
      break;
    case "fechadas":
      f.eq.push(["status", "closed"]);
      break;
    case "todas":
      f.neq.push(["status", "closed"]);
      break;
  }
  return f;
}

async function currentUserId(supabase: Supabase): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function countTab(supabase: Supabase, orgId: string, tab: InboxTab, userId: string | null): Promise<number> {
  const f = tabFilters(tab, userId);
  let query = supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  for (const [c, v] of f.eq) query = query.eq(c, v);
  for (const [c, v] of f.neq) query = query.neq(c, v);
  for (const c of f.isNull) query = query.is(c, null);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function memberNames(orgId: string): Promise<Map<string, string>> {
  return new Map((await listMembers(orgId)).map((m) => [m.userId, m.name]));
}

/** Última mensagem não-interna e não-sistema de cada conversa. */
async function lastMessages(supabase: Supabase, orgId: string, ids: string[]): Promise<Map<string, MessageRow>> {
  const out = new Map<string, MessageRow>();
  if (ids.length === 0) return out;
  const base = () =>
    supabase
      .from("messages")
      .select("id, conversation_id, direction, sender_type, content, created_at")
      .eq("organization_id", orgId)
      .eq("is_internal_note", false)
      .neq("sender_type", "system")
      .order("created_at", { ascending: false });
  const { data, error } = await base()
    .in("conversation_id", ids)
    .limit(ids.length * 10);
  if (error) throw error;
  for (const m of data) if (!out.has(m.conversation_id)) out.set(m.conversation_id, m);
  // Última mensagem fora da janela (conversa com muitas notas/sistema): busca individual.
  await Promise.all(
    ids
      .filter((id) => !out.has(id))
      .map(async (id) => {
        const { data: one, error: oneError } = await base().eq("conversation_id", id).limit(1);
        if (oneError) throw oneError;
        if (one[0]) out.set(id, one[0]);
      }),
  );
  return out;
}

function toItem(r: ConversationRow, members: Map<string, string>, last: MessageRow | undefined) {
  if (!r.contacts || !r.channels) return null;
  const item: ConversationListItem = {
    id: r.id,
    contact: r.contacts,
    channel: { id: r.channels.id, type: r.channels.type },
    status: r.status,
    handledBy: r.handled_by,
    assignedTo: r.assigned_to ? { userId: r.assigned_to, name: members.get(r.assigned_to) ?? "Sem nome" } : null,
    lastMessageAt: r.last_message_at,
    preview: last ? { text: last.content, fromTeam: last.sender_type === "human" } : null,
    // Não lida = a mensagem não-interna mais recente é do contato.
    lastInboundAt: last?.direction === "inbound" ? last.created_at : null,
    lastReadAt: r.last_read_at,
  };
  return item;
}

/** Conversas candidatas à busca: contato (nome/telefone) ou texto de mensagem. */
async function searchCandidates(
  supabase: Supabase,
  orgId: string,
  q: string,
): Promise<{ ids: string[]; textOnly: Set<string> }> {
  const like = `%${escapeLike(q)}%`;
  const digits = q.replace(/\D/g, "");
  const filters = [`name.ilike."${like.replace(/"/g, '""')}"`];
  if (digits.length > 0) filters.push(`phone.ilike."%${digits}%"`);
  const [contacts, msgs] = await Promise.all([
    supabase.from("contacts").select("id").eq("organization_id", orgId).or(filters.join(",")).limit(500),
    supabase
      .from("messages")
      .select("conversation_id")
      .eq("organization_id", orgId)
      .eq("is_internal_note", false)
      .neq("sender_type", "system")
      .ilike("content", like)
      .limit(500),
  ]);
  if (contacts.error) throw contacts.error;
  if (msgs.error) throw msgs.error;
  const contactIds = new Set<string>();
  if (contacts.data.length > 0) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id")
      .eq("organization_id", orgId)
      .in(
        "contact_id",
        contacts.data.map((c) => c.id),
      )
      .limit(500);
    if (error) throw error;
    for (const c of data) contactIds.add(c.id);
  }
  const textOnly = new Set<string>();
  for (const m of msgs.data) if (!contactIds.has(m.conversation_id)) textOnly.add(m.conversation_id);
  return { ids: [...contactIds, ...textOnly], textOnly };
}

export async function listConversations(
  orgId: string,
  opts: { tab: InboxTab; q: string; channelId: string | null; cursor?: string },
): Promise<{ items: ConversationListItem[]; nextCursor: string | null; counts: Record<InboxTab, number> }> {
  const supabase = await createServerClient();
  const userId = await currentUserId(supabase);
  const q = opts.q.trim();
  const search = q ? await searchCandidates(supabase, orgId, q) : null;

  const countsPromise = Promise.all(
    INBOX_TABS.map((t) => (t.value === "fechadas" ? Promise.resolve(0) : countTab(supabase, orgId, t.value, userId))),
  );
  const membersPromise = memberNames(orgId);

  let rows: ConversationRow[] = [];
  if (!search || search.ids.length > 0) {
    const f = tabFilters(opts.tab, userId);
    let query = supabase.from("conversations").select(CONVERSATION_COLUMNS).eq("organization_id", orgId);
    for (const [c, v] of f.eq) query = query.eq(c, v);
    for (const [c, v] of f.neq) query = query.neq(c, v);
    for (const c of f.isNull) query = query.is(c, null);
    if (opts.channelId) query = query.eq("channel_id", opts.channelId);
    if (search) query = query.in("id", search.ids);
    if (opts.cursor && !Number.isNaN(Date.parse(opts.cursor))) query = query.lt("last_message_at", opts.cursor);
    const { data, error } = await query.order("last_message_at", { ascending: false }).limit(PAGE_SIZE + 1);
    if (error) throw error;
    rows = data as unknown as ConversationRow[];
  }

  const countValues = await countsPromise;
  const counts = Object.fromEntries(INBOX_TABS.map((t, i) => [t.value, countValues[i] ?? 0])) as Record<
    InboxTab,
    number
  >;
  const members = await membersPromise;

  const page = rows.slice(0, PAGE_SIZE);
  const nextCursor = rows.length > PAGE_SIZE ? (page[page.length - 1]?.last_message_at ?? null) : null;
  const lasts = await lastMessages(
    supabase,
    orgId,
    page.map((r) => r.id),
  );
  const needle = q.toLowerCase();
  const items: ConversationListItem[] = [];
  for (const r of page) {
    const last = lasts.get(r.id);
    // Achada só pelo texto: vale apenas se a última mensagem (a prévia) contém o termo.
    if (search?.textOnly.has(r.id) && !(last?.content.toLowerCase().includes(needle) ?? false)) continue;
    const item = toItem(r, members, last);
    if (item) items.push(item);
  }
  return { items, nextCursor, counts };
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
    .select("id, direction, sender_type, sender_user_id, content, is_internal_note, status, error, created_at")
    .eq("organization_id", orgId)
    .eq("conversation_id", id);
  if (before && !Number.isNaN(Date.parse(before))) query = query.lt("created_at", before);
  const [{ data: msgs, error: msgError }, members] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(PAGE_SIZE + 1),
    memberNames(orgId),
  ]);
  if (msgError) throw msgError;

  const messages: MessageItem[] = msgs
    .slice(0, PAGE_SIZE)
    .reverse()
    .map((m) => ({
      id: m.id,
      direction: m.direction,
      senderType: m.sender_type,
      senderName: m.sender_type === "human" && m.sender_user_id ? (members.get(m.sender_user_id) ?? null) : null,
      text: m.content,
      isInternalNote: m.is_internal_note,
      status: m.status,
      error: m.error,
      createdAt: m.created_at,
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
      intent: r.intent,
      sentiment: r.sentiment,
      summary: r.summary,
    },
    messages,
    hasMore: msgs.length > PAGE_SIZE,
  };
}
