import { cache } from "react";
import {
  CONTACTS_PAGE_SIZE,
  TAG_COLORS,
  contactDisplayName,
  matchesDealQuery,
  type ContactFilters,
  type KanbanFilters,
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

/** Membros da org (memoizado por requisição: várias partes da página pedem a mesma lista). */
export const listMembers = cache(async (orgId: string): Promise<MemberOption[]> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, profiles(full_name)")
    .eq("organization_id", orgId);
  if (error) throw new Error("Falha ao carregar membros", { cause: error });
  return data
    .map((m) => ({ userId: m.user_id, name: m.profiles?.full_name?.trim() || "Sem nome" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
});

/** Tags da org com contagem de contatos (memoizado por requisição). */
export const listTags = cache(async (orgId: string): Promise<TagOption[]> => {
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
});

/** Fuso horário da organização (memoizado por requisição). */
export const getOrgTimezone = cache(async (orgId: string): Promise<string> => {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("organizations").select("timezone").eq("id", orgId).single();
  if (error) throw new Error("Falha ao carregar organização", { cause: error });
  return data.timezone ?? DEFAULT_TIMEZONE;
});

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export type ContactDeal = {
  id: string;
  title: string;
  value: number;
  status: "open" | "won" | "lost";
  stageName: string;
  ownerName: string | null;
  updatedAt: string;
};

export type ContactEvent = {
  id: string;
  type: string;
  createdAt: string;
  fromStage: string | null;
  toStage: string | null;
};

export type ContactDetail = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: ContactStatus;
  source: ContactSource;
  leadScore: number;
  assignedTo: string | null;
  assigneeName: string | null;
  lastInteractionAt: string | null;
  createdAt: string;
  tags: { id: string; name: string; color: TagColor }[];
  customFields: { key: string; value: string }[];
  deals: ContactDeal[];
  events: ContactEvent[];
  timezone: string;
};

const REMOVED_STAGE = "etapa removida";
const HISTORY_LIMIT = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getContact(orgId: string, id: string): Promise<ContactDetail | null> {
  // Id malformado nunca existe (evita o erro 22P02 do Postgres).
  if (!UUID_RE.test(id)) return null;
  const supabase = await createServerClient();

  const { data: c, error } = await supabase
    .from("contacts")
    .select("*, contact_tags(tags(id, name, color)), contact_custom_fields(key, value, created_at)")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Falha ao carregar contato", { cause: error });
  if (!c) return null;

  const [dealsRes, eventsRes, stagesRes, timezone, members] = await Promise.all([
    supabase
      .from("deals")
      .select("id, title, value, status, stage_id, owner_id, updated_at")
      .eq("organization_id", orgId)
      .eq("contact_id", id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("events")
      .select("id, type, payload, created_at")
      .eq("organization_id", orgId)
      .eq("contact_id", id)
      .in("type", ["contact_created", "deal_created", "deal_stage_changed", "deal_won", "deal_lost"])
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    supabase.from("pipeline_stages").select("id, name").eq("organization_id", orgId),
    getOrgTimezone(orgId),
    listMembers(orgId),
  ]);
  for (const r of [dealsRes, eventsRes, stagesRes]) {
    if (r.error) throw new Error("Falha ao carregar contato", { cause: r.error });
  }

  const stageName = new Map((stagesRes.data ?? []).map((s) => [s.id, s.name]));
  const memberName = new Map(members.map((m) => [m.userId, m.name]));
  const nameOf = (sid: unknown) =>
    typeof sid === "string" ? (stageName.get(sid) ?? REMOVED_STAGE) : null;

  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    status: c.status,
    source: c.source,
    leadScore: c.lead_score,
    assignedTo: c.assigned_to,
    assigneeName: c.assigned_to ? (memberName.get(c.assigned_to) ?? null) : null,
    lastInteractionAt: c.last_interaction_at,
    createdAt: c.created_at,
    tags: c.contact_tags
      .flatMap((ct) => (ct.tags ? [ct.tags] : []))
      .map((t) => ({ id: t.id, name: t.name, color: toTagColor(t.color) }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    customFields: [...c.contact_custom_fields]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((f) => ({ key: f.key, value: f.value ?? "" })),
    deals: (dealsRes.data ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      value: Number(d.value),
      status: d.status,
      stageName: stageName.get(d.stage_id) ?? REMOVED_STAGE,
      ownerName: d.owner_id ? (memberName.get(d.owner_id) ?? null) : null,
      updatedAt: d.updated_at,
    })),
    events: (eventsRes.data ?? []).map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return {
        id: e.id,
        type: e.type,
        createdAt: e.created_at,
        fromStage: nameOf(p.from_stage_id),
        toStage: nameOf(p.to_stage_id),
      };
    }),
    timezone,
  };
}

export type BoardStage = { id: string; name: string; position: number; isWon: boolean; isLost: boolean };
export type BoardDeal = {
  id: string;
  stageId: string;
  title: string;
  value: number;
  contact: { id: string; name: string; phone: string | null; email: string | null; leadScore: number };
  ownerId: string | null;
  ownerName: string | null;
};
export type Board = { pipelineId: string; stages: BoardStage[]; deals: BoardDeal[] };

const CLOSED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Quadro do pipeline padrão: deals abertos e (conforme o filtro) encerrados recentes ou todos. */
export async function getBoard(orgId: string, f: KanbanFilters): Promise<Board> {
  const supabase = await createServerClient();
  const { data: pipeline, error: pipeError } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .maybeSingle();
  if (pipeError) throw new Error("Falha ao carregar pipeline", { cause: pipeError });
  if (!pipeline) throw new Error("Pipeline padrão não encontrado");

  let dealsQuery = supabase
    .from("deals")
    .select(
      "id, stage_id, title, value, status, owner_id, updated_at, contacts(id, name, phone, email, lead_score)",
    )
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipeline.id);
  if (f.ownerId) dealsQuery = dealsQuery.eq("owner_id", f.ownerId);
  if (f.closed === "30d") {
    const since = new Date(Date.now() - CLOSED_WINDOW_MS).toISOString();
    dealsQuery = dealsQuery.or(`status.eq.open,updated_at.gte.${since}`);
  }

  const [stagesRes, dealsRes, members] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, name, position, is_won, is_lost")
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipeline.id)
      .order("position"),
    dealsQuery.order("updated_at", { ascending: false }),
    listMembers(orgId),
  ]);
  if (stagesRes.error) throw new Error("Falha ao carregar etapas", { cause: stagesRes.error });
  if (dealsRes.error) throw new Error("Falha ao carregar deals", { cause: dealsRes.error });

  const memberName = new Map(members.map((m) => [m.userId, m.name]));
  const deals: BoardDeal[] = [];
  for (const d of dealsRes.data) {
    if (!d.contacts) continue;
    const contact = {
      id: d.contacts.id,
      name: contactDisplayName(d.contacts),
      phone: d.contacts.phone,
      email: d.contacts.email,
      leadScore: d.contacts.lead_score,
    };
    if (!matchesDealQuery(f.q, { contactName: contact.name, phone: contact.phone, email: contact.email, title: d.title })) {
      continue;
    }
    deals.push({
      id: d.id,
      stageId: d.stage_id,
      title: d.title,
      value: Number(d.value),
      contact,
      ownerId: d.owner_id,
      ownerName: d.owner_id ? (memberName.get(d.owner_id) ?? null) : null,
    });
  }

  return {
    pipelineId: pipeline.id,
    stages: stagesRes.data.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      isWon: s.is_won,
      isLost: s.is_lost,
    })),
    deals,
  };
}

export type StageWithCount = BoardStage & { dealCount: number };

/** Etapas do pipeline padrão com a contagem de TODOS os deals (inclusive encerrados). */
export async function getStagesWithCounts(orgId: string): Promise<{ pipelineId: string; stages: StageWithCount[] }> {
  const supabase = await createServerClient();
  const { data: pipeline, error: pipeError } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .maybeSingle();
  if (pipeError) throw new Error("Falha ao carregar pipeline", { cause: pipeError });
  if (!pipeline) throw new Error("Pipeline padrão não encontrado");

  // Uma consulta: etapas com a contagem agregada dos deals (relação pela FK composta).
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("id, name, position, is_won, is_lost, deals!deals_organization_id_pipeline_id_stage_id_fkey(count)")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipeline.id)
    .order("position");
  if (error) throw new Error("Falha ao carregar etapas", { cause: error });

  return {
    pipelineId: pipeline.id,
    stages: data.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      isWon: s.is_won,
      isLost: s.is_lost,
      dealCount: s.deals[0]?.count ?? 0,
    })),
  };
}
