"use server";

import { z } from "zod";
import { entryLinkInputSchema } from "@flowai/core";
import type { ActionResult } from "@/lib/action-result";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { GROWTH_FORBIDDEN, growthError } from "./messages";

const admins = ["owner", "admin"];
const idSchema = z.uuid();
async function context(roles = admins) {
  const org = await getActiveOrg();
  if (!org || !roles.includes(org.role)) return null;
  const db = await createServerClient();
  const { data: { user } } = await db.auth.getUser();
  return user ? { orgId: org.id, db } : null;
}
const forbidden = () => ({ ok: false as const, error: GROWTH_FORBIDDEN });

export async function saveEntryLink({ id = null, input }: { id?: string | null; input: unknown }): Promise<ActionResult<{ id: string }>> {
  const c = await context();
  if (!c) return forbidden();
  const parsed = entryLinkInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Confira os dados informados.", fieldErrors: parsed.error.flatten().fieldErrors };
  if (id !== null && !idSchema.safeParse(id).success) return { ok: false, error: "Link inválido." };
  const { data, error } = await c.db.rpc("save_entry_link", {
    p_org: c.orgId, p_id: id as unknown as string, p_input: parsed.data,
  });
  if (error) return { ok: false, error: growthError(error) };
  return { ok: true, data: { id: data } };
}

export async function archiveEntryLink(id: string): Promise<ActionResult> {
  const c = await context();
  if (!c) return forbidden();
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Link inválido." };
  const { error } = await c.db.rpc("archive_entry_link", { p_id: id });
  return error ? { ok: false, error: growthError(error) } : { ok: true, data: undefined };
}

const simulationSchema = z.object({
  linkId: idSchema,
  phone: z.string().trim().min(1, "Informe o telefone.").max(100),
  name: z.string().trim().max(120),
});
export async function simulateEntryLink(input: { linkId: string; phone: string; name: string }): Promise<ActionResult<{ conversationId: string }>> {
  const c = await context(["owner", "admin", "agent"]);
  if (!c) return forbidden();
  const parsed = simulationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Confira os dados informados.", fieldErrors: parsed.error.flatten().fieldErrors };
  const { data, error } = await c.db.rpc("simulate_entry_link", {
    p_link: parsed.data.linkId, p_contact_phone: parsed.data.phone, p_contact_name: parsed.data.name,
  });
  return error ? { ok: false, error: growthError(error) } : { ok: true, data: { conversationId: data } };
}

export async function setInstagramUsername(channelId: string, username: string): Promise<ActionResult> {
  const c = await context();
  if (!c) return forbidden();
  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  if (!idSchema.safeParse(channelId).success || !/^[a-z0-9._]{1,30}$/.test(normalized)) return { ok: false, error: "Informe um usuário do Instagram válido." };
  const { error } = await c.db.rpc("set_instagram_username", { p_channel: channelId, p_username: normalized });
  return error ? { ok: false, error: growthError(error) } : { ok: true, data: undefined };
}
