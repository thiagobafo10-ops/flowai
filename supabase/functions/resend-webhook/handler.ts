import { BodyTooLarge, readLimitedBody } from "../_shared/http.ts";

export type ResendWebhookDeps = {
  /** One Resend webhook per account: each organization's secret is tried. */
  readSecrets(): Promise<{ organizationId: string; secret: string }[]>;
  record(organizationIds: string[], providerId: string, type: string, at: string | null): Promise<void>;
  now(): Date;
};
const TOLERANCE_S = 300;
function result(error: string, status: number) { return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } }); }
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

// Svix scheme: HMAC-SHA256 of `${id}.${timestamp}.${body}` keyed by the base64 part after "whsec_".
async function verifySvix(headers: Headers, body: Uint8Array, secrets: { organizationId: string; secret: string }[], now: Date): Promise<string[]> {
  const id = headers.get("svix-id"), ts = headers.get("svix-timestamp"), header = headers.get("svix-signature");
  if (!id || !ts || !header || !/^\d{1,12}$/.test(ts) || Math.abs(now.getTime() / 1000 - Number(ts)) > TOLERANCE_S) return [];
  const signed = new Uint8Array([...new TextEncoder().encode(`${id}.${ts}.`), ...body]);
  const signatures: Uint8Array<ArrayBuffer>[] = [];
  for (const part of header.split(" ").slice(0, 10)) {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) continue;
    try { signatures.push(fromBase64(value)); } catch { /* malformed entry */ }
  }
  const organizations: string[] = [];
  for (const { organizationId, secret } of secrets) {
    let key: CryptoKey;
    try { key = await crypto.subtle.importKey("raw", fromBase64(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]); }
    catch { continue; }
    // verify() compares in constant time
    for (const signature of signatures) if (await crypto.subtle.verify("HMAC", key, signature, signed)) { organizations.push(organizationId); break; }
  }
  return organizations;
}

export async function handleResendWebhook(request: Request, deps: ResendWebhookDeps): Promise<Response> {
  if (request.method !== "POST") return result("method_not_allowed", 405);
  try {
    const body = await readLimitedBody(request, 262144);
    const organizations = await verifySvix(request.headers, body, await deps.readSecrets(), deps.now());
    if (organizations.length === 0) return result("invalid_signature", 401);
    let event: { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } };
    try { event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
    catch { return result("invalid_payload", 400); }
    const emailId = event?.data?.email_id;
    // Signed but unusable events are acknowledged so Resend does not retry them forever.
    if (typeof event?.type !== "string" || typeof emailId !== "string") return Response.json({ ok: true, ignored: true });
    const at = typeof event.created_at === "string" && Number.isFinite(Date.parse(event.created_at)) ? event.created_at : null;
    await deps.record(organizations, emailId, event.type, at);
    return Response.json({ ok: true });
  } catch (error) { return error instanceof BodyTooLarge ? result("body_too_large", 413) : result("temporarily_unavailable", 503); }
}
