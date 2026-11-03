import { unsubscribe } from "../actions";

/** One-click do List-Unsubscribe (RFC 8058): sempre 200 sem detalhe, válido ou não. */
export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  await unsubscribe((await params).token);
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
