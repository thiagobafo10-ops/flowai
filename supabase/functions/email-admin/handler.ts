import { renderEmail, type EmailContent } from "../../../packages/core/src/email/template.ts";
import type { Authorize } from "../_shared/auth.ts";
import { BodyTooLarge, readLimitedBody } from "../_shared/http.ts";
import { sendResendEmail } from "../_shared/resend.ts";

export type EmailSettingsSecret = { resendKey: string | null; fromName: string; fromEmail: string; replyTo: string | null };
export type EmailAdminDeps = {
  authorize: Authorize;
  /** The logged-in user (from the request's JWT). */
  readUser(request: Request): Promise<{ email: string; name: string | null } | null>;
  /** Reads the step with the user's own JWT (RLS: members only). */
  readStep(request: Request, organizationId: string, stepId: string): Promise<EmailContent | null>;
  readSettings(organizationId: string): Promise<EmailSettingsSecret | null>;
  recordDomainStatus(organizationId: string, status: DomainStatus): Promise<void>;
  fetch: typeof fetch;
};
type DomainStatus = "verified" | "pending" | "failed" | "not_found";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function json(data: unknown, status = 200): Response { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
const SAMPLE_ITEMS = [
  { name: "Produto de exemplo", variant: "Tamanho M", quantity: 1, price: 129.9, imageUrl: null },
  { name: "Outro produto", variant: null, quantity: 1, price: 49.9, imageUrl: null },
];

function mapDomainStatus(status: unknown): DomainStatus {
  if (status === "verified") return "verified";
  if (status === "failed" || status === "failure") return "failed";
  return "pending"; // pending, not_started, temporary_failure
}

export async function handleEmailAdmin(request: Request, deps: EmailAdminDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    let input: Record<string, unknown>;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readLimitedBody(request, 8192))); }
    catch (error) { return error instanceof BodyTooLarge ? json({ error: "body_too_large" }, 413) : json({ error: "invalid_input" }, 400); }
    if (!input || typeof input !== "object" || typeof input.organizationId !== "string" || !uuid.test(input.organizationId)) return json({ error: "invalid_input" }, 400);
    const organizationId = input.organizationId;
    if (!await deps.authorize(request, organizationId, "admin")) return json({ error: "forbidden" }, 403);
    if (input.action !== "test" && input.action !== "verify_domain") return json({ error: "invalid_input" }, 400);
    if (input.action === "test" && (typeof input.stepId !== "string" || !uuid.test(input.stepId))) return json({ error: "invalid_input" }, 400);
    const settings = await deps.readSettings(organizationId);
    if (!settings?.resendKey) return json({ error: "no_settings" }, 409);

    if (input.action === "verify_domain") {
      const response = await deps.fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${settings.resendKey}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) { await response.body?.cancel(); return json({ error: "provider_unavailable" }, 502); }
      const body = await response.json() as { data?: { name?: unknown; status?: unknown }[] };
      const domain = settings.fromEmail.split("@").pop()!.toLowerCase();
      const found = Array.isArray(body?.data) ? body.data.find((item) => typeof item?.name === "string" && item.name.toLowerCase() === domain) : undefined;
      const status = found ? mapDomainStatus(found.status) : "not_found";
      await deps.recordDomainStatus(organizationId, status);
      return json({ status });
    }

    // test: not recorded in email_sends; sample order, no unsubscribe link (the admin is not a contact).
    const step = await deps.readStep(request, organizationId, input.stepId as string);
    if (!step) return json({ error: "not_found" }, 404);
    const user = await deps.readUser(request);
    if (!user?.email) return json({ error: "no_email" }, 422);
    const firstName = user.name?.trim().split(/\s+/)[0] || null;
    const rendered = renderEmail(step, {
      storeName: settings.fromName, firstName, name: user.name, total: 179.8, items: SAMPLE_ITEMS,
      buttonUrl: "https://example.com/carrinho", unsubscribeUrl: null,
    });
    const sent = await sendResendEmail(deps.fetch, settings.resendKey, {
      from: `${settings.fromName} <${settings.fromEmail}>`, to: user.email, replyTo: settings.replyTo, ...rendered,
    }, crypto.randomUUID());
    return sent.ok ? json({ sent: true }) : json({ error: sent.code }, 502);
  } catch { return json({ error: "temporarily_unavailable" }, 503); }
}
