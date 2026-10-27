import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveMcpContext } from "@/lib/mcp/context";
import { createMcpServer } from "@/lib/mcp/server";

// Com Cache Components a rota já é dinâmica (lê a requisição) e roda em Node.js;
// `runtime`/`dynamic` não são aceitos nessa configuração.

const MAX_BODY_BYTES = 1024 * 1024;

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** Streamable HTTP sem sessão: um servidor + transporte por requisição, respostas JSON. */
export async function POST(request: Request): Promise<Response> {
  const ctx = await resolveMcpContext(request);
  if (ctx instanceof Response) return ctx;
  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY_BYTES,
  });
  try {
    await server.connect(transport);
    return noStore(await transport.handleRequest(request));
  } finally {
    await server.close();
  }
}

/**
 * Sem sessão não há fluxo SSE do servidor nem sessão para encerrar: GET/DELETE
 * autenticam (para o 401 com resource_metadata) e respondem 405.
 */
async function methodNotAllowed(request: Request): Promise<Response> {
  const ctx = await resolveMcpContext(request);
  if (ctx instanceof Response) return ctx;
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
    { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
  );
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
