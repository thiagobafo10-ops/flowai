"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { contactSchema, tagSchema, type ContactInput, type TagColor } from "@flowai/core";
import type { ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { toTagColor } from "@/lib/crm/queries";

const MSG_FORBIDDEN = "Você não tem permissão para esta ação.";
const MSG_UNEXPECTED = "Não foi possível concluir. Tente novamente.";
const WRITE_ROLES = ["agent", "admin", "owner"];

function dbError(context: string, error: { code?: string }): { ok: false; error: string } {
  if (error.code === "42501") return { ok: false, error: MSG_FORBIDDEN };
  console.error(context, error);
  return { ok: false, error: MSG_UNEXPECTED };
}

/**
 * Cria (contactId nulo) ou edita um contato. Na edição os campos personalizados nunca são
 * enviados (o diálogo não os mostra) e as tags só quando `opts.tags` indica que mudaram:
 * conjunto nulo = inalterado no banco, sem sobrescrever o que outra pessoa gravou.
 */
export async function saveContact(
  contactId: string | null,
  input: ContactInput,
  opts: { tags?: boolean } = {},
): Promise<ActionResult<{ id: string; duplicateOf: { id: string; name: string } | null }>> {
  const org = await getActiveOrg();
  if (!org || !WRITE_ROLES.includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "name");
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: parsed.error.issues[0]?.message ?? MSG_UNEXPECTED, fieldErrors };
  }
  const c = parsed.data;

  if (contactId !== null && !z.uuid().safeParse(contactId).success) return { ok: false, error: MSG_UNEXPECTED };
  const isEdit = contactId !== null;
  const tagIds = !isEdit || opts.tags ? c.tagIds : null;
  const customFields = isEdit ? null : c.customFields;

  const supabase = await createServerClient();
  const { data: id, error } = await supabase.rpc("save_contact", {
    p_org: org.id,
    p_contact_id: contactId as string, // a função trata null (criação)
    p_data: {
      name: c.name,
      phone: c.phone,
      email: c.email,
      status: c.status,
      assigned_to: c.assignedTo,
      lead_score: c.leadScore,
    },
    // Os tipos gerados não marcam os parâmetros como anuláveis; a função trata null (= inalterado).
    p_tag_ids: tagIds as string[],
    p_custom_fields: customFields as { key: string; value: string }[],
  });
  if (error || !id) return dbError("save_contact failed", error ?? {});

  // Aviso de duplicidade (não bloqueante): outro contato com o mesmo telefone ou e-mail.
  let duplicateOf: { id: string; name: string } | null = null;
  for (const [column, value] of [
    ["phone", c.phone],
    ["email", c.email],
  ] as const) {
    if (!value || duplicateOf) continue;
    const { data: dup, error: dupError } = await supabase
      .from("contacts")
      .select("id, name, phone, email")
      .eq("organization_id", org.id)
      .eq(column, value)
      .neq("id", id)
      .order("created_at")
      .limit(1);
    if (dupError) {
      console.error("duplicate lookup failed", dupError);
      continue;
    }
    const d = dup[0];
    if (d) duplicateOf = { id: d.id, name: d.name || d.phone || d.email || "Sem nome" };
  }

  return { ok: true, data: { id, duplicateOf } };
}

export async function createTagInline(
  name: string,
): Promise<ActionResult<{ id: string; name: string; color: TagColor }>> {
  const org = await getActiveOrg();
  if (!org || !WRITE_ROLES.includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };

  const parsed = tagSchema.pick({ name: true }).safeParse({ name });
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? MSG_UNEXPECTED;
    return { ok: false, error: message, fieldErrors: { name: [message] } };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("tags")
    .insert({ organization_id: org.id, name: parsed.data.name, color: "slate" })
    .select("id, name, color")
    .single();
  if (!error) return { ok: true, data: { id: data.id, name: data.name, color: toTagColor(data.color) } };

  if (error.code === "23505") {
    // Nome repetido (sem diferenciar maiúsculas): devolve a tag existente.
    const { data: all, error: listError } = await supabase
      .from("tags")
      .select("id, name, color")
      .eq("organization_id", org.id);
    if (listError) return dbError("tag lookup failed", listError);
    const existing = all.find((t) => t.name.toLowerCase() === parsed.data.name.toLowerCase());
    if (existing) {
      return { ok: true, data: { id: existing.id, name: existing.name, color: toTagColor(existing.color) } };
    }
  }
  return dbError("create tag failed", error);
}

// save_contact parcial: conjunto nulo = inalterado (array vazio limpa). Sem leitura prévia, sem corrida.
async function savePart(
  contactId: string,
  tagIds: string[] | null,
  customFields: { key: string; value: string }[] | null,
): Promise<ActionResult> {
  const org = await getActiveOrg();
  if (!org || !WRITE_ROLES.includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };

  const supabase = await createServerClient();
  const { error } = await supabase.rpc("save_contact", {
    p_org: org.id,
    p_contact_id: contactId,
    p_data: {},
    p_tag_ids: tagIds as string[],
    p_custom_fields: customFields as { key: string; value: string }[],
  });
  if (error) return dbError("save_contact failed", error);
  return { ok: true, data: undefined };
}

export async function setContactTags(contactId: string, tagIds: string[]): Promise<ActionResult> {
  const parsed = z.array(z.uuid()).safeParse(tagIds);
  if (!parsed.success || !z.uuid().safeParse(contactId).success) return { ok: false, error: MSG_UNEXPECTED };
  return savePart(contactId, parsed.data, null);
}

export async function saveCustomFields(
  contactId: string,
  fields: { key: string; value: string }[],
): Promise<ActionResult> {
  const parsed = contactSchema.shape.customFields.safeParse(fields);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? MSG_UNEXPECTED };
  if (!z.uuid().safeParse(contactId).success) return { ok: false, error: MSG_UNEXPECTED };
  return savePart(contactId, null, parsed.data);
}

export async function deleteContact(contactId: string): Promise<ActionResult> {
  const org = await getActiveOrg();
  if (!org || !["admin", "owner"].includes(org.role)) return { ok: false, error: MSG_FORBIDDEN };
  if (!z.uuid().safeParse(contactId).success) return { ok: false, error: MSG_UNEXPECTED };

  const supabase = await createServerClient();
  // select() distingue "RLS não apagou nada" de sucesso.
  const { data, error } = await supabase
    .from("contacts")
    .delete()
    .eq("organization_id", org.id)
    .eq("id", contactId)
    .select("id");
  if (error) return dbError("delete contact failed", error);
  if (data.length === 0) return { ok: false, error: MSG_FORBIDDEN };
  redirect("/contatos");
}
