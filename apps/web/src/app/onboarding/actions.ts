"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createOrganizationSchema } from "@flowai/core";
import type { CreateOrganizationInput } from "@flowai/core";
import { createServerClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE, getActiveOrg } from "@/lib/org/active-org";
import type { ActionResult } from "@/lib/action-result";

const MSG_NAME_REQUIRED = "Informe o nome da empresa.";
const MSG_UNEXPECTED = "Não foi possível concluir. Tente novamente.";

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<ActionResult> {
  const parsed = createOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? MSG_NAME_REQUIRED,
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // Proteção server-side contra organização duplicada.
  if (await getActiveOrg()) redirect("/dashboard");

  const supabase = await createServerClient();
  const { data: orgId, error } = await supabase.rpc(
    "create_organization_with_owner",
    { p_name: parsed.data.name },
  );
  if (error || !orgId) {
    if (error?.code === "22023") {
      return { ok: false, error: MSG_NAME_REQUIRED };
    }
    console.error("create_organization_with_owner failed", error);
    return { ok: false, error: MSG_UNEXPECTED };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  redirect("/dashboard");
}
