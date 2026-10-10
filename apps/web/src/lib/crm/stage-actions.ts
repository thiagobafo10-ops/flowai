"use server";

import { z } from "zod";
import { stageNameSchema } from "@flowai/core";
import type { ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";

const MSG_FORBIDDEN = "Você não tem permissão para esta ação.";
const MSG_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
const MSG_DUPLICATE = "Já existe uma etapa com este nome.";
const MSG_NAME_LENGTH = "O nome da etapa deve ter entre 1 e 40 caracteres.";
const ADMIN_ROLES = ["admin", "owner"];

type Fail = { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function rpcError(context: string, error: { code?: string; message?: string }, opts?: { name?: boolean }): Fail {
  const { code, message = "" } = error;
  if (code === "42501") return { ok: false, error: MSG_FORBIDDEN };
  if (code === "23505") {
    if (opts?.name) return { ok: false, error: MSG_DUPLICATE, fieldErrors: { name: [MSG_DUPLICATE] } };
    return { ok: false, error: "Não foi possível: um contato ficaria com dois deals abertos." };
  }
  if (code === "23514" || (code === "22023" && opts?.name)) {
    return { ok: false, error: MSG_NAME_LENGTH, fieldErrors: { name: [MSG_NAME_LENGTH] } };
  }
  if (code === "22023") {
    if (message.includes("last_open_stage")) {
      return { ok: false, error: "O pipeline precisa de ao menos uma etapa aberta." };
    }
    if (message.includes("outcome_required")) {
      return { ok: false, error: "O pipeline precisa de uma etapa de Ganho e uma de Perdido." };
    }
    if (message.includes("target_is_outcome")) {
      return { ok: false, error: "Escolha uma etapa aberta como destino." };
    }
  }
  console.error(context, error);
  return { ok: false, error: MSG_UNEXPECTED };
}

async function adminOrg() {
  const org = await getActiveOrg();
  if (!org || !ADMIN_ROLES.includes(org.role)) return null;
  return org;
}

function parseName(name: string): ActionResult<string> {
  const parsed = stageNameSchema.safeParse(name);
  if (parsed.success) return { ok: true, data: parsed.data };
  const msg = parsed.error.issues[0]?.message ?? MSG_NAME_LENGTH;
  return { ok: false, error: msg, fieldErrors: { name: [msg] } };
}

export async function createStage(name: string): Promise<ActionResult<{ id: string }>> {
  const org = await adminOrg();
  if (!org) return { ok: false, error: MSG_FORBIDDEN };
  const parsed = parseName(name);
  if (!parsed.ok) return parsed;

  const supabase = await createServerClient();
  const { data: pipeline, error: pipeError } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", org.id)
    .eq("is_default", true)
    .maybeSingle();
  if (pipeError || !pipeline) return rpcError("create stage: pipeline lookup failed", pipeError ?? {});
  const { data, error } = await supabase.rpc("create_stage", { p_pipeline: pipeline.id, p_name: parsed.data });
  if (error) return rpcError("create stage failed", error, { name: true });
  return { ok: true, data: { id: data } };
}

export async function renameStage(id: string, name: string): Promise<ActionResult> {
  const org = await adminOrg();
  if (!org) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: MSG_UNEXPECTED };
  const parsed = parseName(name);
  if (!parsed.ok) return parsed;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("pipeline_stages")
    .update({ name: parsed.data })
    .eq("organization_id", org.id)
    .eq("id", id)
    .select("id");
  if (error) return rpcError("rename stage failed", error, { name: true });
  if (data.length === 0) return { ok: false, error: MSG_FORBIDDEN };
  return { ok: true, data: undefined };
}

export async function reorderStages(ids: string[]): Promise<ActionResult> {
  const org = await adminOrg();
  if (!org) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.array(z.uuid()).min(1).safeParse(ids).success) return { ok: false, error: MSG_UNEXPECTED };

  const supabase = await createServerClient();
  const { data: pipeline, error: pipeError } = await supabase
    .from("pipelines")
    .select("id")
    .eq("organization_id", org.id)
    .eq("is_default", true)
    .maybeSingle();
  if (pipeError || !pipeline) return rpcError("reorder stages: pipeline lookup failed", pipeError ?? {});
  const { error } = await supabase.rpc("reorder_stages", { p_pipeline: pipeline.id, p_stage_ids: ids });
  if (error) return rpcError("reorder stages failed", error);
  return { ok: true, data: undefined };
}

export async function deleteStage(id: string, targetId: string): Promise<ActionResult> {
  const org = await adminOrg();
  if (!org) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(targetId).success) {
    return { ok: false, error: MSG_UNEXPECTED };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("delete_stage_moving_deals", { p_stage: id, p_target_stage: targetId });
  if (error) return rpcError("delete stage failed", error);
  return { ok: true, data: undefined };
}

export async function setStageOutcome(id: string, outcome: "won" | "lost"): Promise<ActionResult> {
  const org = await adminOrg();
  if (!org) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.uuid().safeParse(id).success || (outcome !== "won" && outcome !== "lost")) {
    return { ok: false, error: MSG_UNEXPECTED };
  }
  const supabase = await createServerClient();
  const { error } = await supabase.rpc("set_stage_outcome", { p_stage: id, p_outcome: outcome });
  if (error) return rpcError("set stage outcome failed", error);
  return { ok: true, data: undefined };
}
