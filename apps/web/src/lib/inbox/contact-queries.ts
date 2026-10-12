import { z } from "zod";
import { getBoard, getContact, listMembers, listTags } from "@/lib/crm/queries";
import { createServerClient } from "@/lib/supabase/server";

export async function getContactPanel(orgId: string, contactId: string, conversationId: string) {
  if (!z.uuid().safeParse(contactId).success || !z.uuid().safeParse(conversationId).success) return null;
  const supabase = await createServerClient();
  const { data: conversation, error } = await supabase.from("conversations")
    .select("id, intent, sentiment, summary").eq("organization_id", orgId)
    .eq("contact_id", contactId).eq("id", conversationId).maybeSingle();
  if (error) throw new Error("Falha ao carregar contato", { cause: error });
  if (!conversation) return null;
  const [contact, tags, members, board] = await Promise.all([
    getContact(orgId, contactId), listTags(orgId), listMembers(orgId),
    getBoard(orgId, { q: "", ownerId: null, closed: "30d" }),
  ]);
  if (!contact) return null;
  const openId = contact.deals.find((d) => d.status === "open")?.id;
  return { contact, tags: tags.map(({ id, name, color }) => ({ id, name, color })), members,
    stages: board.stages, deal: board.deals.find((d) => d.id === openId) ?? null,
    intelligence: { intent: conversation.intent, sentiment: conversation.sentiment, summary: conversation.summary } };
}

export type ContactPanelData = NonNullable<Awaited<ReturnType<typeof getContactPanel>>>;

export async function listContactConversations(orgId: string, contactId: string) {
  if (!z.uuid().safeParse(contactId).success) return [];
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("conversations")
    .select("id, status, last_message_at, channels(type)").eq("organization_id", orgId)
    .eq("contact_id", contactId).order("last_message_at", { ascending: false });
  if (error) throw new Error("Falha ao carregar conversas", { cause: error });
  return Promise.all((data ?? []).map(async (c) => {
    const { data: messages, error: messageError } = await supabase.from("messages")
      .select("content").eq("organization_id", orgId).eq("conversation_id", c.id)
      .eq("is_internal_note", false).neq("sender_type", "system")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1);
    if (messageError) throw new Error("Falha ao carregar conversas", { cause: messageError });
    return { id: c.id, status: c.status, channelType: c.channels?.type ?? null,
      lastMessageAt: c.last_message_at, preview: messages?.[0]?.content ?? null };
  }));
}
