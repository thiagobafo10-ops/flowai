/**
 * Metadados de recurso protegido (RFC 9728) do conector MCP. O servidor de
 * autorização é o Supabase Auth do projeto; o recurso é `<origem>/mcp`.
 */

const HOST_PATTERN = /^[a-z0-9.-]+(:\d{1,5})?$/i;

function firstHeaderValue(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.split(",")[0]?.trim();
  return value ? value : null;
}

/** Origem pública da requisição; na Vercel, respeita x-forwarded-host/proto. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = firstHeaderValue(request, "x-forwarded-host");
  const forwardedProto = firstHeaderValue(request, "x-forwarded-proto")?.toLowerCase() ?? null;
  const host = forwardedHost && HOST_PATTERN.test(forwardedHost) ? forwardedHost : url.host;
  const proto =
    forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/mcp`;
}

export type ProtectedResourceMetadata = {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
};

export function protectedResourceMetadata(origin: string): ProtectedResourceMetadata {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [`${supabaseUrl}/auth/v1`],
    bearer_methods_supported: ["header"],
  };
}

export function protectedResourceMetadataResponse(request: Request): Response {
  return Response.json(protectedResourceMetadata(requestOrigin(request)), {
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}
