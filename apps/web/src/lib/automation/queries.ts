import type { AutomationGraph, GraphRefs, TriggerType } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createServerClient>>;

export type AutomationStatus = "draft" | "active" | "paused";
export type AutomationRow = {
  id: string;
  name: string;
  triggerType: TriggerType;
  status: AutomationStatus;
  runs7d: number;
  clicks7d: number;
  contacts7d: number;
  /** Automação criada pelo MCP: guarda o formato simples em `mcp_spec`. */
  createdByClaude: boolean;
  updatedAt: string;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type ResultRow = { runs: number; clicks: number; contacts: number };

/** Contagem do jsonb: só número finito e positivo vale; qualquer outra coisa vira zero. */
function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Lê o jsonb de `automation_results` sem confiar no formato (payload inesperado vira zero). */
function readResults(value: unknown): Map<string, ResultRow> {
  const rows = new Map<string, ResultRow>();
  if (!Array.isArray(value)) return rows;
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as { automationId?: unknown; runs?: unknown; uniqueContacts?: unknown; clicks?: unknown };
    if (typeof row.automationId !== "string") continue;
    const clicks = typeof row.clicks === "object" && row.clicks !== null ? (row.clicks as { total?: unknown }).total : 0;
    rows.set(row.automationId, {
      runs: toCount(row.runs),
      clicks: toCount(clicks),
      contacts: toCount(row.uniqueContacts),
    });
  }
  return rows;
}

/** Lista com disparos, cliques e contatos dos últimos 7 dias (RPC agrupada, sujeita ao RLS). */
export async function listAutomations(orgId: string, now: Date = new Date()): Promise<AutomationRow[]> {
  const supabase = await createServerClient();
  const from = new Date(now.getTime() - WEEK_MS).toISOString();
  const [automations, results] = await Promise.all([
    supabase
      .from("automations")
      .select("id, name, trigger_type, status, updated_at, mcp_spec")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false }),
    supabase.rpc("automation_results", { p_org: orgId, p_from: from, p_to: now.toISOString() }),
  ]);
  if (automations.error) throw automations.error;
  if (results.error) throw results.error;
  const stats = readResults(results.data);
  return (automations.data ?? []).map((a) => {
    const row = stats.get(a.id);
    return {
      id: a.id,
      name: a.name,
      triggerType: a.trigger_type as TriggerType,
      status: a.status as AutomationStatus,
      runs7d: row?.runs ?? 0,
      clicks7d: row?.clicks ?? 0,
      contacts7d: row?.contacts ?? 0,
      createdByClaude: a.mcp_spec !== null && a.mcp_spec !== undefined,
      updatedAt: a.updated_at,
    };
  });
}

export type RefsBundle = {
  refs: GraphRefs;
  defaults: { channelId: string | null; tagId: string | null; tagId2: string | null; stageId: string | null };
};

/** Referências da organização ativa usadas por `validateGraph` e pelos modelos. */
export async function loadGraphRefs(supabase: Supabase, orgId: string): Promise<RefsBundle> {
  const [tags, pipeline, members, channels, sequences, links] = await Promise.all([
    supabase.from("tags").select("id").eq("organization_id", orgId).order("created_at"),
    supabase.from("pipelines").select("id").eq("organization_id", orgId).eq("is_default", true).maybeSingle(),
    supabase.from("memberships").select("user_id").eq("organization_id", orgId),
    supabase.from("channels").select("id").eq("organization_id", orgId).eq("type", "instagram").order("created_at"),
    supabase.from("sequences").select("id").eq("organization_id", orgId),
    supabase.from("entry_links").select("id").eq("organization_id", orgId),
  ]);
  for (const r of [tags, pipeline, members, channels, sequences, links]) if (r.error) throw r.error;
  let stages: { id: string; is_won: boolean; is_lost: boolean }[] = [];
  if (pipeline.data) {
    const res = await supabase
      .from("pipeline_stages")
      .select("id, is_won, is_lost")
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipeline.data.id)
      .order("position");
    if (res.error) throw res.error;
    stages = res.data ?? [];
  }
  const tagIds = (tags.data ?? []).map((t) => t.id);
  const channelIds = (channels.data ?? []).map((c) => c.id);
  return {
    refs: {
      tagIds,
      stageIds: stages.map((s) => s.id),
      userIds: (members.data ?? []).map((m) => m.user_id),
      channelIds,
      sequenceIds: (sequences.data ?? []).map((s) => s.id),
      entryLinkIds: (links.data ?? []).map((l) => l.id),
    },
    defaults: {
      channelId: channelIds[0] ?? null,
      tagId: tagIds[0] ?? null,
      tagId2: tagIds[1] ?? null,
      stageId: stages.find((s) => !s.is_won && !s.is_lost)?.id ?? null,
    },
  };
}

export type RefOption = { id: string; name: string };
export type EditorRefs = {
  tags: RefOption[];
  stages: RefOption[];
  members: RefOption[];
  channels: (RefOption & { type: string })[];
  entryLinks: RefOption[];
  sequences: RefOption[];
};

/** Opções nomeadas para os seletores do editor (etiquetas, etapas do funil padrão, membros, canais e sequências). */
export async function loadEditorRefs(supabase: Supabase, orgId: string): Promise<EditorRefs> {
  const [tags, pipeline, members, channels, links, sequences] = await Promise.all([
    supabase.from("tags").select("id, name").eq("organization_id", orgId).order("name"),
    supabase.from("pipelines").select("id").eq("organization_id", orgId).eq("is_default", true).maybeSingle(),
    supabase.from("memberships").select("user_id, profiles(full_name)").eq("organization_id", orgId),
    supabase.from("channels").select("id, name, type").eq("organization_id", orgId).order("created_at"),
    supabase.from("entry_links").select("id, name").eq("organization_id", orgId).order("name"),
    supabase.from("sequences").select("id, name").eq("organization_id", orgId).order("name"),
  ]);
  for (const r of [tags, pipeline, members, channels, links, sequences]) if (r.error) throw r.error;
  let stages: RefOption[] = [];
  if (pipeline.data) {
    const res = await supabase
      .from("pipeline_stages")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipeline.data.id)
      .order("position");
    if (res.error) throw res.error;
    stages = (res.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  }
  return {
    tags: (tags.data ?? []).map((t) => ({ id: t.id, name: t.name })),
    stages,
    members: (members.data ?? [])
      .map((m) => ({ id: m.user_id, name: m.profiles?.full_name?.trim() || "Sem nome" }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    channels: (channels.data ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type as string })),
    entryLinks: links.data ?? [],
    sequences: sequences.data ?? [],
  };
}

export type LoadedAutomation = {
  id: string;
  name: string;
  status: AutomationStatus;
  triggerType: TriggerType;
  triggerConfig: unknown;
  currentVersion: number;
  graph: AutomationGraph;
};

/** Automação completa (gatilho + grafo) da organização; null quando não existe. */
export async function loadAutomation(supabase: Supabase, orgId: string, id: string): Promise<LoadedAutomation | null> {
  const [automation, nodes, edges] = await Promise.all([
    supabase.from("automations").select("id, name, status, trigger_type, trigger_config, current_version").eq("organization_id", orgId).eq("id", id).maybeSingle(),
    supabase.from("automation_nodes").select("id, type, config, position").eq("organization_id", orgId).eq("automation_id", id).order("created_at"),
    supabase.from("automation_edges").select("id, source_node_id, target_node_id, source_handle").eq("organization_id", orgId).eq("automation_id", id).order("created_at"),
  ]);
  if (automation.error) throw automation.error;
  if (nodes.error) throw nodes.error;
  if (edges.error) throw edges.error;
  const a = automation.data;
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    status: a.status as AutomationStatus,
    triggerType: a.trigger_type as TriggerType,
    triggerConfig: a.trigger_config,
    currentVersion: a.current_version,
    graph: {
      nodes: (nodes.data ?? []).map((n) => ({
        id: n.id,
        type: n.type as AutomationGraph["nodes"][number]["type"],
        config: n.config,
        position: n.position as { x: number; y: number },
      })),
      edges: (edges.data ?? []).map((e) => ({
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        sourceHandle: e.source_handle,
      })),
    },
  };
}
