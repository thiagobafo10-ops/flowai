import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@flowai/core";
import { requestOrigin, resourceMetadataUrl } from "./resource-metadata";

export type McpRole = "owner" | "admin" | "agent" | "viewer";

export type McpContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  orgId: string;
  role: McpRole;
  channel: { id: string; connectionId: string } | null;
  accessToken: string;
};

const BEARER_PATTERN = /^Bearer[ ]+(\S+)[ ]*$/i;

function challenge(request: Request, error?: string): string {
  const metadata = `resource_metadata="${resourceMetadataUrl(requestOrigin(request))}"`;
  return error ? `Bearer error="${error}", ${metadata}` : `Bearer ${metadata}`;
}

function authError(request: Request, status: 401 | 403, error: string, challengeError?: string): Response {
  return Response.json(
    { error },
    { status, headers: { "WWW-Authenticate": challenge(request, challengeError), "Cache-Control": "no-store" } },
  );
}

function serverError(): Response {
  return Response.json({ error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

function bearerToken(request: Request): string | null {
  const match = request.headers.get("authorization")?.match(BEARER_PATTERN);
  return match?.[1] ?? null;
}

/**
 * Valida o JWT do Supabase recebido pelo conector MCP e monta um cliente com o
 * token do próprio usuário (RLS do painel). Nunca usa a chave de serviço.
 */
export async function resolveMcpContext(request: Request): Promise<McpContext | Response> {
  const accessToken = bearerToken(request);
  if (!accessToken) return authError(request, 401, "unauthorized");

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );

  // getUser(token) valida assinatura/expiração no servidor Auth do projeto.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);
  if (userError || !user) return authError(request, 401, "invalid_token", "invalid_token");

  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("organization_id, role, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (membershipError) {
    console.error("mcp context: memberships query failed", membershipError.code ?? "unknown");
    return serverError();
  }
  const membership =
    memberships.find((m) => m.role === "owner" || m.role === "admin") ?? memberships[0];
  if (!membership) return authError(request, 403, "no_organization");

  const { data: channels, error: channelError } = await supabase
    .from("channels")
    .select("id, meta_connection_id, created_at")
    .eq("organization_id", membership.organization_id)
    .eq("type", "instagram")
    .eq("status", "active")
    .not("meta_connection_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (channelError) {
    console.error("mcp context: channels query failed", channelError.code ?? "unknown");
    return serverError();
  }
  const row = channels.find((c) => c.meta_connection_id);
  const channel = row?.meta_connection_id ? { id: row.id, connectionId: row.meta_connection_id } : null;

  return {
    supabase,
    userId: user.id,
    orgId: membership.organization_id,
    role: membership.role,
    channel,
    accessToken,
  };
}
