import {
  CONTACTS_PAGE_SIZE,
  TAG_COLORS,
  type ContactFilters,
  type ContactSource,
  type ContactStatus,
  type TagColor,
} from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";

export type ContactRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: ContactStatus;
  source: ContactSource;
  leadScore: number;
  assignedTo: string | null;
  lastInteractionAt: string | null;
  createdAt: string;
  tagIds: string[];
};

export type TagOption = { id: string; name: string; color: TagColor; contactCount: number };
export type MemberOption = { userId: string; name: string };

export function toTagColor(v: string): TagColor {
  return (TAG_COLORS as readonly string[]).includes(v) ? (v as TagColor) : "slate";
}

// Os tipos gerados não marcam os parâmetros da RPC como anuláveis; a função trata null.
const nullable = <T>(v: T | null): T => v as T;

export async function listContacts(
  orgId: string,
  f: ContactFilters,
): Promise<{ rows: ContactRow[]; total: number }> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("search_contacts", {
    p_org: orgId,
    p_q: f.q,
    p_status: nullable(f.status),
    p_tag: nullable(f.tagId),
    p_assignee: nullable(f.assignee),
    p_source: nullable(f.source),
    p_order: f.order,
    p_limit: CONTACTS_PAGE_SIZE,
    p_offset: (f.page - 1) * CONTACTS_PAGE_SIZE,
  });
  if (error) throw new Error("Falha ao carregar contatos", { cause: error });
  const rows = data.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    status: r.status,
    source: r.source,
    leadScore: r.lead_score,
    assignedTo: r.assigned_to,
    lastInteractionAt: r.last_interaction_at,
    createdAt: r.created_at,
    tagIds: r.tag_ids,
  }));
  // total_count some quando a página passa do fim (0 linhas): o chamador trata.
  return { rows, total: data.length > 0 ? Number(data[0].total_count) : 0 };
}

export async function listMembers(orgId: string): Promise<MemberOption[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, profiles(full_name)")
    .eq("organization_id", orgId);
  if (error) throw new Error("Falha ao carregar membros", { cause: error });
  return data
    .map((m) => ({ userId: m.user_id, name: m.profiles?.full_name?.trim() || "Sem nome" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function listTags(orgId: string): Promise<TagOption[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("tags")
    .select("id, name, color, contact_tags(count)")
    .eq("organization_id", orgId)
    .order("name");
  if (error) throw new Error("Falha ao carregar tags", { cause: error });
  return data.map((t) => ({
    id: t.id,
    name: t.name,
    color: toTagColor(t.color),
    contactCount: t.contact_tags[0]?.count ?? 0,
  }));
}
