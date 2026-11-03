import { createServerClient } from "@/lib/supabase/server";

export type EmailStep = {
  id: string; position: number; delayMinutes: number; enabled: boolean;
  subject: string; heading: string; body: string; buttonLabel: string; coupon: string;
};
export type EmailSendRow = {
  id: string; toEmail: string; position: number | null; state: string; cancelReason: string | null;
  sendAt: string; deliveredAt: string | null; openedAt: string | null; clickedAt: string | null; bouncedAt: string | null; errorCode: string | null;
};
export type StepResult = {
  stepId: string; position: number; scheduled: number; sent: number; delivered: number; opened: number; clicked: number;
  cancelled: Record<string, number>; recoveredOrders: number; recoveredTotal: number;
};
export type EmailsView = {
  store: { id: string; alias: string } | null;
  settings: { fromName: string; fromEmail: string; replyTo: string; domainStatus: string | null } | null;
  journey: { enabled: boolean; steps: EmailStep[] } | null;
  sends: EmailSendRow[];
  results: StepResult[];
  webhooks: { yampi: string | null; resend: string };
};

const DAY = 86_400_000;

export async function loadEmailsView(orgId: string): Promise<EmailsView> {
  const db = await createServerClient();
  const now = Date.now();
  const [store, settings, journey, steps, sends, results] = await Promise.all([
    db.from("store_connections").select("id,merchant_alias").eq("organization_id", orgId).maybeSingle(),
    db.from("email_settings").select("from_name,from_email,reply_to,domain_status").eq("organization_id", orgId).maybeSingle(),
    db.from("email_journeys").select("id,enabled").eq("organization_id", orgId).eq("kind", "cart").maybeSingle(),
    db.from("email_journey_steps").select("id,journey_id,position,delay_minutes,enabled,subject,heading,body,button_label,coupon").eq("organization_id", orgId).order("position"),
    db.from("email_sends").select("id,to_email,step_id,state,cancel_reason,send_at,delivered_at,opened_at,clicked_at,bounced_at,error_code")
      .eq("organization_id", orgId).order("created_at", { ascending: false }).limit(100),
    db.rpc("email_journey_results", { p_org: orgId, p_from: new Date(now - 30 * DAY).toISOString(), p_to: new Date(now).toISOString() }),
  ]);
  for (const r of [store, settings, journey, steps, sends, results]) if (r.error) throw new Error("Não foi possível carregar os e-mails da loja.");

  const position = new Map((steps.data ?? []).map((s) => [s.id, s.position]));
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return {
    store: store.data ? { id: store.data.id, alias: store.data.merchant_alias } : null,
    settings: settings.data
      ? { fromName: settings.data.from_name, fromEmail: settings.data.from_email, replyTo: settings.data.reply_to ?? "", domainStatus: settings.data.domain_status }
      : null,
    journey: journey.data
      ? {
          enabled: journey.data.enabled,
          steps: (steps.data ?? []).filter((s) => s.journey_id === journey.data!.id).map((s) => ({
            id: s.id, position: s.position, delayMinutes: s.delay_minutes, enabled: s.enabled, subject: s.subject,
            heading: s.heading, body: s.body, buttonLabel: s.button_label, coupon: s.coupon,
          })),
        }
      : null,
    sends: (sends.data ?? []).map((s) => ({
      id: s.id, toEmail: s.to_email, position: position.get(s.step_id) ?? null, state: s.state, cancelReason: s.cancel_reason,
      sendAt: s.send_at, deliveredAt: s.delivered_at, openedAt: s.opened_at, clickedAt: s.clicked_at, bouncedAt: s.bounced_at, errorCode: s.error_code,
    })),
    results: Array.isArray(results.data) ? (results.data as unknown as StepResult[]) : [],
    webhooks: { yampi: store.data ? `${base}/functions/v1/yampi-webhook/${store.data.id}` : null, resend: `${base}/functions/v1/resend-webhook` },
  };
}
