import { parseYampiEvent, verifyYampiSignature } from "../../../packages/core/src/store/yampi.ts";
import type { YampiEvent } from "../../../packages/core/src/store/yampi.ts";
import { BodyTooLarge, readLimitedBody } from "../_shared/http.ts";
import { clientIp } from "../meta-webhook/handler.ts";

export type YampiWebhookDeps = {
  readConnection(id: string): Promise<{ organizationId: string; secret: string } | null>;
  /** Coarse per-IP limit, applied before any credential read or signature check. */
  allowIp(ip: string): Promise<boolean>;
  ingest(id: string, event: YampiEvent, bodyHash: string): Promise<unknown>;
};
function result(error: string, status: number) { return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }); }
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function handleYampiWebhook(request: Request, deps: YampiWebhookDeps): Promise<Response> {
  const match = new URL(request.url).pathname.match(/\/yampi-webhook\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  if (!match) return result("not_found", 404);
  if (request.method !== "POST") return result("method_not_allowed", 405);
  const id = match[1];
  try {
    if (!await deps.allowIp(clientIp(request.headers))) return result("rate_limited", 429);
    const connection = await deps.readConnection(id);
    if (!connection) return result("not_found", 404);
    const body = await readLimitedBody(request, 1048576);
    if (!await verifyYampiSignature(body, request.headers.get("x-yampi-hmac-sha256"), connection.secret)) return result("invalid_signature", 401);
    let event: YampiEvent;
    try { event = parseYampiEvent(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))); }
    catch { return result("invalid_payload", 400); }
    if (event.kind === "ignored") return Response.json({ ok: true, ignored: true });
    await deps.ingest(id, event, hex(await crypto.subtle.digest("SHA-256", Uint8Array.from(body))));
    return Response.json({ ok: true });
  } catch (error) { return result(error instanceof BodyTooLarge ? "body_too_large" : "temporarily_unavailable", error instanceof BodyTooLarge ? 413 : 503); }
}
