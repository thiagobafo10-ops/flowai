"use server";

import { z } from "zod";
import { contactDisplayName, dealSchema, type DealInput } from "@flowai/core";
import type { ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";

const MSG_FORBIDDEN = "Você não tem permissão para esta ação.";
const MSG_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
const MSG_OPEN_DEAL = "Este contato já tem um deal aberto.";
const MSG_DEAL_GONE = "Este deal não existe mais.";
const WRITE_ROLES = ["agent", "admin", "owner"];

type DbError = { code?: string };

function dbError(context: string, error: DbError): { ok: false; error: string } {
  if (error.code === "42501") return { ok: false, error: MSG_FORBIDDEN };
  if (error.code === "23505") return { ok: false, error: MSG_OPEN_DEAL };
  console.error(context, error);
  return { ok: false, error: MSG_UNEXPECTED };
}

function parseDeal(input: DealInput): ActionResult<DealInput> {
  const parsed = dealSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "title");
    (fieldErrors[key] ??= []).push(key === "contactId" ? "Selecione um contato." : issue.message);
  }
  const first = Object.values(fieldErrors)[0]?.[0] ?? MSG_UNEXPECTED;
  return { ok: false, error: first, fieldErrors };
}

export async function createDeal(input: DealInput): Promise<ActionResult<{ id: string }>> {
  const org = await getActiveOrg();
  if (!org || !WRITE_ROLES.includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };
  const parsed = parseDeal(input);
  if (!parsed.ok) return parsed;
  const d = parsed.data;

  const supabase = await createServerClient();
  const { data: stage, error: stageError } = await supabase
    .from("pipeline_stages")
    .select("pipeline_id")
    .eq("organization_id", org.id)
    .eq("id", d.stageId)
    .maybeSingle();
  if (stageError) return dbError("deal stage lookup failed", stageError);
  if (!stage) return { ok: false, error: "Esta etapa não existe mais.", fieldErrors: { stageId: ["Esta etapa não existe mais."] } };

  const { data, error } = await supabase
    .from("deals")
    .insert({
      organization_id: org.id,
      pipeline_id: stage.pipeline_id,
      stage_id: d.stageId,
      contact_id: d.contactId,
      title: d.title,
      value: d.value,
      owner_id: d.ownerId,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "O contato ou o responsável não existe mais." };
    }
    return dbError("create deal failed", error);
  }
  return { ok: true, data: { id: data.id } };
}

export async function updateDeal(id: string, input: DealInput): Promise<ActionResult> {
  const org = await getActiveOrg();
  if (!org || !WRITE_ROLES.includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: MSG_DEAL_GONE };
  const parsed = parseDeal(input);
  if (!parsed.ok) return parsed;
  const d = parsed.data;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("deals")
    .update({ stage_id: d.stageId, title: d.title, value: d.value, owner_id: d.ownerId })
    .eq("organization_id", org.id)
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === "23503") return { ok: false, error: MSG_DEAL_GONE };
    return dbError("update deal failed", error);
  }
  if (data.length === 0) return { ok: false, error: MSG_DEAL_GONE };
  return { ok: true, data: undefined };
}

export async function moveDeal(id: string, stageId: string): Promise<ActionResult> {
  const org = await getActiveOrg();
  if (!org || !WRITE_ROLES.includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(stageId).success) {
    return { ok: false, error: MSG_DEAL_GONE };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("deals")
    .update({ stage_id: stageId })
    .eq("organization_id", org.id)
    .eq("id", id)
    .select("id");
  if (error) {
    // Etapa removida enquanto o quadro estava aberto.
    if (error.code === "23503") return { ok: false, error: MSG_DEAL_GONE };
    return dbError("move deal failed", error);
  }
  if (data.length === 0) return { ok: false, error: MSG_DEAL_GONE };
  return { ok: true, data: undefined };
}

export async function deleteDeal(id: string): Promise<ActionResult> {
  const org = await getActiveOrg();
  if (!org || !["admin", "owner"].includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: MSG_DEAL_GONE };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("deals")
    .delete()
    .eq("organization_id", org.id)
    .eq("id", id)
    .select("id");
  if (error) return dbError("delete deal failed", error);
  if (data.length === 0) return { ok: false, error: MSG_DEAL_GONE };
  return { ok: true, data: undefined };
}

export type DealContactOption = { id: string; name: string; detail: string | null; hasOpenDeal: boolean };

/** Busca de contato para o diálogo do deal (até 10), marcando quem já tem deal aberto. */
export async function searchDealContacts(q: string): Promise<ActionResult<DealContactOption[]>> {
  const org = await getActiveOrg();
  if (!org || !WRITE_ROLES.includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };
  const parsed = z.string().max(100).safeParse(q);
  if (!parsed.success) return { ok: false, error: MSG_UNEXPECTED };

  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc("search_contacts", {
    p_org: org.id,
    p_q: parsed.data.trim(),
    p_status: null as never,
    p_tag: null as never,
    p_assignee: null as never,
    p_source: null as never,
    p_order: "nome",
    p_limit: 10,
    p_offset: 0,
  });
  if (error) return dbError("search contacts for deal failed", error);

  const ids = data.map((c) => c.id);
  const open = new Set<string>();
  if (ids.length > 0) {
    const { data: deals, error: dealsError } = await supabase
      .from("deals")
      .select("contact_id")
      .eq("organization_id", org.id)
      .eq("status", "open")
      .in("contact_id", ids);
    if (dealsError) return dbError("open deals lookup failed", dealsError);
    for (const d of deals) open.add(d.contact_id);
  }

  return {
    ok: true,
    data: data.map((c) => ({
      id: c.id,
      name: contactDisplayName(c),
      detail: c.name ? (c.phone ?? c.email ?? null) : null,
      hasOpenDeal: open.has(c.id),
    })),
  };
}
