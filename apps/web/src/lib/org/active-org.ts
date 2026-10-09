import { cache } from "react";
import { cookies } from "next/headers";
import { resolveActiveOrg, type OrgRole } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";

export const ACTIVE_ORG_COOKIE = "flowai_org";

export type ActiveOrg = { id: string; name: string; role: OrgRole };

/**
 * Única fonte de organização ativa no servidor. O cookie é apenas uma
 * preferência: só vale se houver membership retornada pela RLS da sessão do usuário.
 */
export const getActiveOrg = cache(async (): Promise<ActiveOrg | null> => {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("memberships")
    .select("organization_id, role, created_at, organizations(id, name)")
    .eq("user_id", user.id);
  if (error || !data || data.length === 0) return null;

  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value ?? null;

  const activeId = resolveActiveOrg(
    cookieOrgId,
    data.map((m) => ({ organizationId: m.organization_id, createdAt: m.created_at })),
  );
  if (!activeId) return null;

  const membership = data.find((m) => m.organization_id === activeId);
  const org = membership?.organizations;
  if (!membership || !org) return null;
  return { id: org.id, name: org.name, role: membership.role };
});
