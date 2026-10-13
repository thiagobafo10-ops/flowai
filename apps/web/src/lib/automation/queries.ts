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
  updatedAt: string;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Lista com a contagem de execuções dos últimos 7 dias (uma consulta de execuções, agrupada aqui). */
export async function listAutomations(orgId: string, now: Date = new Date()): Promise<AutomationRow[]> {
  const supabase = await createServerClient();
  const since = new Date(now.getTime() - WEEK_MS).toISOString();
  const [automations, runs] = await Promise.all([
    supabase
      .from("automations")
      .select("id, name, trigger_type, status, updated_at")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false }),
    supabase.from("automation_runs").select("automation_id").eq("organization_id", orgId).gte("created_at", since),
  ]);
  if (automations.error) throw automations.error;
  if (runs.error) throw runs.error;
  const counts = new Map<string, number>();
  for (const r of runs.data ?? []) counts.set(r.automation_id, (counts.get(r.automation_id) ?? 0) + 1);
  return (automations.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    triggerType: a.trigger_type as TriggerType,
    status: a.status as AutomationStatus,
    runs7d: counts.get(a.id) ?? 0,
    updatedAt: a.updated_at,
  }));
}

export type RefsBundle = {
  refs: GraphRefs;
  defaults: { channelId: string | null; tagId: string | null; stageId: string | null };
};

/** Referências da organização ativa usadas por `validateGraph` e pelos modelos. */
export async function loadGraphRefs(supabase: Supabase, orgId: string): Promise<RefsBundle> {
  const [tags, pipeline, members, channels] = await Promise.all([
    supabase.from("tags").select("id").eq("organization_id", orgId).order("created_at"),
    supabase.from("pipelines").select("id").eq("organization_id", orgId).eq("is_default", true).maybeSingle(),
    supabase.from("memberships").select("user_id").eq("organization_id", orgId),
    supabase.from("channels").select("id").eq("organization_id", orgId).eq("type", "instagram").order("created_at"),
  ]);
  for (const r of [tags, pipeline, members, channels]) if (r.error) throw r.error;
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
    },
    defaults: {
      channelId: channelIds[0] ?? null,
      tagId: tagIds[0] ?? null,
      stageId: stages.find((s) => !s.is_won && !s.is_lost)?.id ?? null,
    },
  };
}

export type LoadedAutomation = {
  id: string;
  name: string;
  status: AutomationStatus;
  triggerType: TriggerType;
  triggerConfig: unknown;
  graph: AutomationGraph;
};

/** Automação completa (gatilho + grafo) da organização; null quando não existe. */
export async function loadAutomation(supabase: Supabase, orgId: string, id: string): Promise<LoadedAutomation | null> {
  const [automation, nodes, edges] = await Promise.all([
    supabase.from("automations").select("id, name, status, trigger_type, trigger_config").eq("organization_id", orgId).eq("id", id).maybeSingle(),
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
