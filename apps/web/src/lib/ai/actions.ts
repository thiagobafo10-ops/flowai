"use server";

import { z } from "zod";
import { knowledgeDocumentSchema } from "@flowai/core";
import type { ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { AI_DOCUMENT_GONE, AI_DOCUMENT_INVALID, AI_FORBIDDEN, AI_STATUS_FAILED, AI_UNEXPECTED } from "./messages";

type Supabase = Awaited<ReturnType<typeof createServerClient>>;
type Fail = { ok: false; error: string };
type Ctx = { orgId: string; supabase: Supabase };

/** Sessão + organização ativa; escritas exigem owner/admin. */
async function context(write: boolean): Promise<Ctx | Fail> {
  const org = await getActiveOrg();
  if (!org || (write && !["owner", "admin"].includes(org.role))) return { ok: false, error: AI_FORBIDDEN };
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: AI_FORBIDDEN };
  return { orgId: org.id, supabase };
}

function dbError(label: string, error: { code?: string }): Fail {
  if (error.code === "42501") return { ok: false, error: AI_FORBIDDEN };
  if (error.code === "P0002") return { ok: false, error: AI_DOCUMENT_GONE };
  if (error.code === "22023") return { ok: false, error: "Confira o título e o conteúdo do documento." };
  console.error(label, error.code);
  return { ok: false, error: AI_UNEXPECTED };
}

const idSchema = z.uuid();
const saveSchema = knowledgeDocumentSchema.extend({ id: idSchema.optional() });

export async function saveKnowledgeDocument(input: { id?: string; title: string; content: string }): Promise<ActionResult<{ id: string }>> {
  const c = await context(true);
  if (!("supabase" in c)) return c;
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[String(issue.path[0] ?? "title")] ??= []).push(issue.message);
    return { ok: false, error: parsed.error.issues[0]?.message ?? AI_UNEXPECTED, fieldErrors };
  }
  const { data, error } = await c.supabase.rpc("save_knowledge_document", {
    p_org: c.orgId,
    // A RPC aceita null (criação); os tipos gerados não marcam o argumento como opcional.
    p_id: (parsed.data.id ?? null) as string,
    p_title: parsed.data.title,
    p_content: parsed.data.content,
  });
  if (error) return dbError("save knowledge document failed", error);
  return { ok: true, data: { id: data as string } };
}

export async function reprocessKnowledgeDocument(id: string): Promise<ActionResult> {
  const c = await context(true);
  if (!("supabase" in c)) return c;
  if (!idSchema.safeParse(id).success) return { ok: false, error: AI_DOCUMENT_INVALID };
  const { error } = await c.supabase.rpc("reprocess_knowledge_document", { p_id: id });
  if (error) return dbError("reprocess knowledge document failed", error);
  return { ok: true, data: undefined };
}

export async function deleteKnowledgeDocument(id: string): Promise<ActionResult> {
  const c = await context(true);
  if (!("supabase" in c)) return c;
  if (!idSchema.safeParse(id).success) return { ok: false, error: AI_DOCUMENT_INVALID };
  const { data, error } = await c.supabase.from("knowledge_documents").delete().eq("organization_id", c.orgId).eq("id", id).select("id");
  if (error) return dbError("delete knowledge document failed", error);
  if (!data || data.length === 0) return { ok: false, error: AI_DOCUMENT_GONE };
  return { ok: true, data: undefined };
}

export async function getAiStatus(): Promise<ActionResult<{ configured: boolean }>> {
  const c = await context(false);
  if (!("supabase" in c)) return c;
  const { data: { session } } = await c.supabase.auth.getSession();
  if (!session) return { ok: false, error: AI_FORBIDDEN };
  const { data, error } = await c.supabase.functions.invoke("ai-playground", {
    body: { organizationId: c.orgId, action: "status" },
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error || typeof data?.configured !== "boolean") return { ok: false, error: AI_STATUS_FAILED };
  return { ok: true, data: { configured: data.configured } };
}

/** Conteúdo completo para edição (a listagem não o traz); somente admin/owner. */
export async function getKnowledgeDocument(id: string): Promise<ActionResult<{ id: string; title: string; content: string }>> {
  const c = await context(true);
  if (!("supabase" in c)) return c;
  if (!idSchema.safeParse(id).success) return { ok: false, error: AI_DOCUMENT_INVALID };
  const { data, error } = await c.supabase.from("knowledge_documents").select("id, title, content").eq("organization_id", c.orgId).eq("id", id).maybeSingle();
  if (error) return dbError("get knowledge document failed", error);
  if (!data) return { ok: false, error: AI_DOCUMENT_GONE };
  return { ok: true, data: { id: data.id, title: data.title, content: data.content } };
}
