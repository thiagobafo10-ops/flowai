import { parseInstagramEvents } from "../../../packages/core/src/channels/instagram/parse.ts";
import { verifyMetaSignature } from "../../../packages/core/src/channels/meta-signature.ts";
import type { InstagramEvent } from "../../../packages/core/src/channels/instagram/types.ts";
import type { MetaSecrets } from "../_shared/meta-repository.ts";
import { BodyTooLarge, constantTimeTextEqual, readLimitedBody } from "../_shared/http.ts";

export type MetaWebhookDeps = {
  readConnectionSecrets(id: string): Promise<MetaSecrets | null>;
  allowRequest(connectionId: string, ip: string): Promise<boolean>;
  ingestEvent(connectionId: string, event: InstagramEvent): Promise<unknown>;
  verifyConnection(id: string, kind: string, success: boolean, error: string | null, generation: number): Promise<void>;
};
function result(error: string, status: number) { return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }); }
export async function handleMetaWebhook(request: Request, deps: MetaWebhookDeps): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(/\/meta-webhook\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  if (!match) return result("not_found", 404);
  if (request.method !== "GET" && request.method !== "POST") return result("method_not_allowed", 405);
  const id = match[1];
  try {
    const ip = (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown").slice(0, 100);
    if (!await deps.allowRequest(id, ip)) return result("rate_limited", 429);
    const secrets = await deps.readConnectionSecrets(id);
    if (!secrets || secrets.disconnected) return result("not_found", 404);
    if (request.method === "GET") {
      const token = url.searchParams.get("hub.verify_token") ?? "";
      const challenge = url.searchParams.get("hub.challenge");
      if (url.searchParams.get("hub.mode") !== "subscribe" || !challenge || token.length > 8192 || !await constantTimeTextEqual(token, secrets.verifyToken)) return result("forbidden", 403);
      await deps.verifyConnection(id, "webhook", true, null, secrets.generation);
      return new Response(challenge, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    }
    const body = await readLimitedBody(request, 1048576);
    if (!await verifyMetaSignature(body, request.headers.get("x-hub-signature-256"), secrets.appSecret)) return result("invalid_signature", 401);
    let events: InstagramEvent[];
    try { events = parseInstagramEvents(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))); }
    catch { return result("invalid_payload", 400); }
    for (const event of events) {
      const channel = secrets.channels.find((item) => item.accountId === event.accountId && item.status === "active");
      if (channel) await deps.ingestEvent(id, event);
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  } catch (error) { return result(error instanceof BodyTooLarge ? "body_too_large" : "temporarily_unavailable", error instanceof BodyTooLarge ? 413 : 503); }
}
