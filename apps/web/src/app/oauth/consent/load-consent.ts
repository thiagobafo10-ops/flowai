import { createServerClient } from "@/lib/supabase/server";

export type ConsentState =
  | { kind: "invalid" }
  | { kind: "login"; to: string }
  | { kind: "redirect"; url: string }
  | { kind: "error" }
  | { kind: "consent"; authorizationId: string; clientName: string };

export function consentPath(authorizationId: string): string {
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}

export function loginPathFor(authorizationId: string): string {
  return `/login?next=${encodeURIComponent(consentPath(authorizationId))}`;
}

/** Estado da tela de consentimento OAuth (servidor de autorização do Supabase). */
export async function loadConsent(authorizationId: string | undefined): Promise<ConsentState> {
  if (!authorizationId) return { kind: "invalid" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "login", to: loginPathFor(authorizationId) };

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) return { kind: "error" };
  // Consentimento já concedido: o Supabase devolve direto a URL de retorno.
  if (!("authorization_id" in data)) return { kind: "redirect", url: data.redirect_url };
  return { kind: "consent", authorizationId: data.authorization_id, clientName: data.client.name };
}
