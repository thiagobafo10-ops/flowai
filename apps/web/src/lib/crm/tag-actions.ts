"use server";

import { z } from "zod";
import { tagSchema, type TagInput } from "@flowai/core";
import type { ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";

const MSG_FORBIDDEN = "Você não tem permissão para esta ação.";
const MSG_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
const MSG_DUPLICATE = "Já existe uma tag com este nome.";
const WRITE_ROLES = ["agent", "admin", "owner"];
const ADMIN_ROLES = ["admin", "owner"];

function parse(input: TagInput): ActionResult<TagInput> {
  const parsed = tagSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of parsed.error.issues) {
    (fieldErrors[String(issue.path[0] ?? "name")] ??= []).push(issue.message);
  }
  return { ok: false, error: parsed.error.issues[0]?.message ?? MSG_UNEXPECTED, fieldErrors };
}

function dbError(context: string, error: { code?: string }): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  if (error.code === "23505") return { ok: false, error: MSG_DUPLICATE, fieldErrors: { name: [MSG_DUPLICATE] } };
  if (error.code === "42501") return { ok: false, error: MSG_FORBIDDEN };
  console.error(context, error);
  return { ok: false, error: MSG_UNEXPECTED };
}

export async function createTag(input: TagInput): Promise<ActionResult<{ id: string }>> {
  const org = await getActiveOrg();
  if (!org || !WRITE_ROLES.includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };
  const parsed = parse(input);
  if (!parsed.ok) return parsed;

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("tags")
    .insert({ organization_id: org.id, name: parsed.data.name, color: parsed.data.color })
    .select("id")
    .single();
  if (error) return dbError("create tag failed", error);
  return { ok: true, data: { id: data.id } };
}

export async function updateTag(id: string, input: TagInput): Promise<ActionResult> {
  const org = await getActiveOrg();
  if (!org || !ADMIN_ROLES.includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: MSG_UNEXPECTED };
  const parsed = parse(input);
  if (!parsed.ok) return parsed;

  const supabase = await createServerClient();
  // select() distingue "RLS não atualizou nada" de sucesso.
  const { data, error } = await supabase
    .from("tags")
    .update({ name: parsed.data.name, color: parsed.data.color })
    .eq("organization_id", org.id)
    .eq("id", id)
    .select("id");
  if (error) return dbError("update tag failed", error);
  if (data.length === 0) return { ok: false, error: MSG_FORBIDDEN };
  return { ok: true, data: undefined };
}

export async function deleteTag(id: string): Promise<ActionResult> {
  const org = await getActiveOrg();
  if (!org || !ADMIN_ROLES.includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.uuid().safeParse(id).success) return { ok: false, error: MSG_UNEXPECTED };

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("tags")
    .delete()
    .eq("organization_id", org.id)
    .eq("id", id)
    .select("id");
  if (error) return dbError("delete tag failed", error);
  if (data.length === 0) return { ok: false, error: MSG_FORBIDDEN };
  return { ok: true, data: undefined };
}
