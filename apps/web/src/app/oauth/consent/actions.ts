"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_ORG_COOKIE } from "@/lib/org/active-org";
import { createServerClient } from "@/lib/supabase/server";
import { consentPath, isValidAuthorizationId, loginPathFor } from "./load-consent";

function authorizationIdFrom(formData: FormData): string {
  const raw = formData.get("authorization_id");
  if (!isValidAuthorizationId(raw)) redirect("/oauth/consent");
  return raw;
}

async function decide(formData: FormData, decision: "approve" | "deny"): Promise<never> {
  const authorizationId = authorizationIdFrom(formData);

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(loginPathFor(authorizationId));

  const options = { skipBrowserRedirect: true };
  const { data, error } =
    decision === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, options)
      : await supabase.auth.oauth.denyAuthorization(authorizationId, options);
  if (error || typeof data?.redirect_url !== "string") {
    console.error(`oauth consent ${decision} failed`, error?.code ?? error?.status ?? "no_redirect");
    redirect(`${consentPath(authorizationId)}&erro=1`);
  }
  redirect(data.redirect_url);
}

export async function approveConsent(formData: FormData): Promise<void> {
  await decide(formData, "approve");
}

export async function denyConsent(formData: FormData): Promise<void> {
  await decide(formData, "deny");
}

/** "Não é você? Sair": encerra a sessão e volta ao login com o mesmo pedido. */
export async function switchAccount(formData: FormData): Promise<void> {
  const authorizationId = authorizationIdFrom(formData);
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ACTIVE_ORG_COOKIE);
  redirect(loginPathFor(authorizationId));
}
