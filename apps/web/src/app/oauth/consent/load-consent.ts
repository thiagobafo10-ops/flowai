import { createServerClient } from "@/lib/supabase/server";

export type ConsentState =
  | { kind: "invalid" }
  | { kind: "login"; to: string }
  | { kind: "redirect"; url: string }
  | { kind: "error" }
  | {
      kind: "consent";
      authorizationId: string;
      clientName: string;
      userEmail: string;
      redirectHost: string | null;
      trustedRedirect: boolean;
    };

const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** O id vai para o caminho da URL do Auth (sem codificação no auth-js): só caracteres seguros. */
export function isValidAuthorizationId(value: unknown): value is string {
  return typeof value === "string" && AUTHORIZATION_ID_PATTERN.test(value);
}

export function consentPath(authorizationId: string): string {
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}

export function loginPathFor(authorizationId: string): string {
  return `/login?next=${encodeURIComponent(consentPath(authorizationId))}`;
}

/** Host do redirect_uri do cliente, ou null se não for uma URL http(s) válida. */
export function redirectHostOf(redirectUri: unknown): string | null {
  if (typeof redirectUri !== "string") return null;
  try {
    const url = new URL(redirectUri);
    return url.protocol === "https:" || url.protocol === "http:" ? url.host : null;
  } catch {
    return null;
  }
}

/** claude.ai, claude.com ou subdomínios deles (sem porta, só https). */
export function isClaudeRedirect(redirectUri: unknown): boolean {
  if (typeof redirectUri !== "string") return false;
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== "https:" || url.port) return false;
    const host = url.hostname.toLowerCase();
    return ["claude.ai", "claude.com"].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/** Estado da tela de consentimento OAuth (servidor de autorização do Supabase). */
export async function loadConsent(authorizationId: string | undefined): Promise<ConsentState> {
  if (!authorizationId) return { kind: "invalid" };
  if (!isValidAuthorizationId(authorizationId)) return { kind: "error" };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "login", to: loginPathFor(authorizationId) };

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) return { kind: "error" };
  // Consentimento já concedido: o Supabase devolve direto a URL de retorno.
  if (!("authorization_id" in data)) {
    return typeof data.redirect_url === "string" ? { kind: "redirect", url: data.redirect_url } : { kind: "error" };
  }
  return {
    kind: "consent",
    authorizationId: data.authorization_id,
    clientName: data.client.name,
    userEmail: user.email ?? data.user.email,
    redirectHost: redirectHostOf(data.redirect_uri),
    trustedRedirect: isClaudeRedirect(data.redirect_uri),
  };
}
