"use server";

import { z } from "zod";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/action-result";

export async function updateContactLeadScore(contactId: string, score: number): Promise<ActionResult> {
  const org = await getActiveOrg();
  if (!org || org.role === "viewer") return { ok: false, error: "Você não tem permissão para esta ação." };
  const parsed = z.object({ id: z.uuid(), score: z.number().int().min(0).max(100) }).safeParse({ id: contactId, score });
  if (!parsed.success) return { ok: false, error: "O lead score deve estar entre 0 e 100." };
  const supabase = await createServerClient();
  const { data, error } = await supabase.from("contacts").update({ lead_score: parsed.data.score })
    .eq("organization_id", org.id).eq("id", parsed.data.id).select("id");
  if (error) {
    console.error("contact lead score failed", error);
    return { ok: false, error: error.code === "42501" ? "Você não tem permissão para esta ação." : "Não foi possível concluir. Tente novamente." };
  }
  if (!data?.length) return { ok: false, error: "Esta conversa não existe mais." };
  return { ok: true, data: undefined };
}
