import { createAuthorize } from "../_shared/auth.ts";
import { handleEmailAdmin, type EmailSettingsSecret } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  // Never propagate the response body: it may echo the key.
  if (!response.ok) { await response.body?.cancel(); throw new Error("Database operation failed"); }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
// As the user: Auth validates the JWT; RLS limits steps to members.
async function asUser<T>(request: Request, path: string): Promise<T | null> {
  const response = await fetch(`${url}${path}`, { headers: { apikey: anonKey, Authorization: request.headers.get("authorization") ?? "" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) { await response.body?.cancel(); return null; }
  return await response.json() as T;
}

Deno.serve((request) => handleEmailAdmin(request, {
  authorize: createAuthorize(url, anonKey, fetch),
  readUser: async (req) => {
    const user = await asUser<{ email?: string; user_metadata?: { full_name?: string; name?: string } }>(req, "/auth/v1/user");
    return user?.email ? { email: user.email, name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null } : null;
  },
  readStep: async (req, organizationId, stepId) => {
    const params = new URLSearchParams({ select: "subject,heading,body,button_label,coupon", organization_id: `eq.${organizationId}`, id: `eq.${stepId}` });
    const rows = await asUser<{ subject: string; heading: string; body: string; button_label: string; coupon: string }[]>(req, `/rest/v1/email_journey_steps?${params}`);
    const step = rows?.[0];
    return step ? { subject: step.subject, heading: step.heading, body: step.body, buttonLabel: step.button_label, coupon: step.coupon.trim() || null } : null;
  },
  readSettings: (organizationId) => rpc<EmailSettingsSecret | null>("read_email_settings_secret", { p_org: organizationId }),
  recordDomainStatus: (organizationId, status) => rpc<void>("record_email_domain_status", { p_org: organizationId, p_status: status }),
  fetch,
}));
