"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  TRIGGER_TYPES,
  automationGraphSchema,
  automationTemplates,
  validateGraph,
  type AutomationGraph,
  type GraphIssue,
  type TriggerType,
} from "@flowai/core";
import type { ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { instantiateTemplate } from "./instantiate";
import { placeholderIssues } from "./placeholders";
import { loadAutomation, loadGraphRefs } from "./queries";
import {
  AUTOMATION_ACTIVATE_WITH_ISSUES,
  AUTOMATION_ACTIVE_WITH_ISSUES,
  AUTOMATION_CREATE_FAILED,
  AUTOMATION_FORBIDDEN,
  AUTOMATION_GONE,
  AUTOMATION_INVALID,
  AUTOMATION_INVALID_GRAPH,
  AUTOMATION_INVALID_NAME,
  AUTOMATION_RERUN_BUSY,
  AUTOMATION_RERUN_INVALID,
  AUTOMATION_RUN_GONE,
  AUTOMATION_UNEXPECTED,
} from "./messages";

type Supabase = Awaited<ReturnType<typeof createServerClient>>;
type Fail = { ok: false; error: string };
type Ctx = { orgId: string; supabase: Supabase };
type DbError = { code?: string; message?: string };

const WRITE_ROLES = ["owner", "admin"];
const STOP_ROLES = ["owner", "admin", "agent"];

/** Sessão + organização ativa; `roles` limita quem pode executar. */
async function context(roles: string[]): Promise<Ctx | Fail> {
  const org = await getActiveOrg();
  if (!org || !roles.includes(org.role)) return { ok: false, error: AUTOMATION_FORBIDDEN };
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: AUTOMATION_FORBIDDEN };
  return { orgId: org.id, supabase };
}

function dbError(label: string, error: DbError, invalid = AUTOMATION_INVALID_GRAPH, gone = AUTOMATION_GONE): Fail {
  if (error.code === "42501") return { ok: false, error: AUTOMATION_FORBIDDEN };
  if (error.code === "P0002") return { ok: false, error: gone };
  if (error.code === "22023") return { ok: false, error: invalid };
  console.error(label, error.code);
  return { ok: false, error: AUTOMATION_UNEXPECTED };
}

function unexpected(label: string, error: unknown): Fail {
  console.error(label, (error as DbError | null)?.code);
  return { ok: false, error: AUTOMATION_UNEXPECTED };
}

const idSchema = z.uuid();
const nameSchema = z.string().trim().min(1, AUTOMATION_INVALID_NAME).max(100, AUTOMATION_INVALID_NAME);
const triggerSchema = z.enum(TRIGGER_TYPES);

type TemplateKey = (typeof automationTemplates)[number]["key"];
const BLANK_NAME = "Nova automação";

export async function createAutomation(input: { templateKey?: TemplateKey; name?: string }): Promise<ActionResult<{ id: string }>> {
  const c = await context(WRITE_ROLES);
  if (!("supabase" in c)) return c;
  const template = input.templateKey ? automationTemplates.find((t) => t.key === input.templateKey) : undefined;
  if (input.templateKey && !template) return { ok: false, error: AUTOMATION_INVALID };
  const name = nameSchema.safeParse(input.name ?? template?.name ?? BLANK_NAME);
  if (!name.success) return { ok: false, error: AUTOMATION_INVALID_NAME };

  let triggerType: TriggerType;
  let triggerConfig: unknown;
  let graph: AutomationGraph;
  try {
    if (template) {
      const { defaults } = await loadGraphRefs(c.supabase, c.orgId);
      ({ triggerConfig, graph } = instantiateTemplate(template, defaults));
      triggerType = template.triggerType;
    } else {
      triggerType = "message_received";
      triggerConfig = { firstMessageOnly: false };
      graph = { nodes: [{ id: randomUUID(), type: "trigger", config: {}, position: { x: 0, y: 0 } }], edges: [] };
    }
  } catch (error) {
    return unexpected("create automation refs failed", error);
  }
  const { data, error } = await c.supabase.rpc("save_automation", {
    p_org: c.orgId,
    // A RPC aceita null (criação); os tipos gerados não marcam o argumento como opcional.
    p_id: null as unknown as string,
    p_name: name.data,
    p_trigger_type: triggerType as never,
    p_trigger_config: triggerConfig as never,
    p_graph: graph as never,
  });
  if (error) return dbError("create automation failed", error, AUTOMATION_CREATE_FAILED);
  return { ok: true, data: { id: data as string } };
}

type SaveInput = { id: string; name: string; triggerType: TriggerType; triggerConfig: unknown; graph: AutomationGraph };

export async function saveAutomation(input: SaveInput): Promise<ActionResult<{ issues: GraphIssue[] }>> {
  const c = await context(WRITE_ROLES);
  if (!("supabase" in c)) return c;
  const id = idSchema.safeParse(input.id);
  if (!id.success) return { ok: false, error: AUTOMATION_INVALID };
  const name = nameSchema.safeParse(input.name);
  if (!name.success) return { ok: false, error: AUTOMATION_INVALID_NAME };
  const trigger = triggerSchema.safeParse(input.triggerType);
  const graph = automationGraphSchema.safeParse(input.graph);
  if (!trigger.success || !graph.success) return { ok: false, error: AUTOMATION_INVALID_GRAPH };

  let issues: GraphIssue[];
  try {
    // O status é lido antes da validação; uma ativação concorrente entre a leitura e a gravação é rara
    // e, nesse caso, o rascunho recém-ativado é salvo sem a recusa acima (sem mudança de SQL).
    const current = await c.supabase.from("automations").select("status").eq("organization_id", c.orgId).eq("id", id.data).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return { ok: false, error: AUTOMATION_GONE };
    const { refs } = await loadGraphRefs(c.supabase, c.orgId);
    issues = [...validateGraph(graph.data, { type: trigger.data, config: input.triggerConfig }, refs), ...placeholderIssues(graph.data, input.triggerConfig)];
    if (current.data.status === "active" && issues.length > 0) return { ok: false, error: AUTOMATION_ACTIVE_WITH_ISSUES };
  } catch (error) {
    return unexpected("save automation validation failed", error);
  }
  const { error } = await c.supabase.rpc("save_automation", {
    p_org: c.orgId,
    p_id: id.data,
    p_name: name.data,
    p_trigger_type: trigger.data as never,
    p_trigger_config: input.triggerConfig as never,
    p_graph: graph.data as never,
  });
  if (error) return dbError("save automation failed", error);
  return { ok: true, data: { issues } };
}

/**
 * Valida e ativa. `activated` é false (sem chamar a RPC) quando o grafo tem problemas:
 * nesse caso `issues` traz a lista e o resultado continua `ok: true`.
 */
export async function activateAutomation(id: string): Promise<ActionResult<{ activated: boolean; issues: GraphIssue[] }>> {
  const c = await context(WRITE_ROLES);
  if (!("supabase" in c)) return c;
  if (!idSchema.safeParse(id).success) return { ok: false, error: AUTOMATION_INVALID };
  let issues: GraphIssue[];
  try {
    const automation = await loadAutomation(c.supabase, c.orgId, id);
    if (!automation) return { ok: false, error: AUTOMATION_GONE };
    const { refs } = await loadGraphRefs(c.supabase, c.orgId);
    issues = [
      ...validateGraph(automation.graph, { type: automation.triggerType, config: automation.triggerConfig }, refs),
      ...placeholderIssues(automation.graph, automation.triggerConfig),
    ];
  } catch (error) {
    return unexpected("activate automation validation failed", error);
  }
  if (issues.length > 0) return { ok: true, data: { activated: false, issues } };
  const { error } = await c.supabase.rpc("activate_automation", { p_id: id });
  if (error) return dbError("activate automation failed", error, AUTOMATION_ACTIVATE_WITH_ISSUES);
  return { ok: true, data: { activated: true, issues: [] } };
}

export async function pauseAutomation(id: string): Promise<ActionResult> {
  const c = await context(WRITE_ROLES);
  if (!("supabase" in c)) return c;
  if (!idSchema.safeParse(id).success) return { ok: false, error: AUTOMATION_INVALID };
  const { error } = await c.supabase.rpc("pause_automation", { p_id: id });
  if (error) return dbError("pause automation failed", error);
  return { ok: true, data: undefined };
}

export async function duplicateAutomation(id: string): Promise<ActionResult<{ id: string }>> {
  const c = await context(WRITE_ROLES);
  if (!("supabase" in c)) return c;
  if (!idSchema.safeParse(id).success) return { ok: false, error: AUTOMATION_INVALID };
  const { data, error } = await c.supabase.rpc("duplicate_automation", { p_id: id });
  if (error) return dbError("duplicate automation failed", error);
  return { ok: true, data: { id: data as string } };
}

export async function deleteAutomation(id: string): Promise<ActionResult> {
  const c = await context(WRITE_ROLES);
  if (!("supabase" in c)) return c;
  if (!idSchema.safeParse(id).success) return { ok: false, error: AUTOMATION_INVALID };
  const { error } = await c.supabase.rpc("delete_automation", { p_id: id });
  if (error) return dbError("delete automation failed", error);
  return { ok: true, data: undefined };
}

export async function rerunFrom(runId: string, nodeId: string): Promise<ActionResult> {
  const c = await context(WRITE_ROLES);
  if (!("supabase" in c)) return c;
  if (!idSchema.safeParse(runId).success || !idSchema.safeParse(nodeId).success) return { ok: false, error: AUTOMATION_INVALID };
  const { error } = await c.supabase.rpc("rerun_automation_from", { p_run: runId, p_node: nodeId });
  if (error) {
    if (error.code === "22023") {
      return { ok: false, error: error.message === "conversation_busy" ? AUTOMATION_RERUN_BUSY : AUTOMATION_RERUN_INVALID };
    }
    return dbError("rerun automation failed", error, AUTOMATION_RERUN_INVALID, AUTOMATION_RUN_GONE);
  }
  return { ok: true, data: undefined };
}

export async function stopAutomation(conversationId: string): Promise<ActionResult> {
  const c = await context(STOP_ROLES);
  if (!("supabase" in c)) return c;
  if (!idSchema.safeParse(conversationId).success) return { ok: false, error: AUTOMATION_INVALID };
  const { error } = await c.supabase.rpc("stop_automation", { p_conversation: conversationId });
  if (error) return dbError("stop automation failed", error);
  return { ok: true, data: undefined };
}
