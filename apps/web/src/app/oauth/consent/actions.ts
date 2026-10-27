"use server";

import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { consentPath, loginPathFor } from "./load-consent";

async function decide(formData: FormData, decision: "approve" | "deny"): Promise<never> {
  const raw = formData.get("authorization_id");
  const authorizationId = typeof raw === "string" ? raw.trim() : "";
  if (!authorizationId || authorizationId.length > 200) redirect("/oauth/consent");

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
  if (error || !data?.redirect_url) {
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
