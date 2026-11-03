import { renderEmail, type EmailContent } from "../../../packages/core/src/email/template.ts";
import type { StoreItem } from "../../../packages/core/src/store/yampi.ts";
import { constantTimeTextEqual } from "../_shared/http.ts";
import { sendResendEmail } from "../_shared/resend.ts";

/** Shape returned by claim_email_sends. */
export type ClaimedSend = {
  sendId: string; toEmail: string; category: "marketing" | "transactional";
  content: EmailContent;
  ctx: { storeName: string; firstName: string | null; name: string | null; total: number | null; items: StoreItem[] | null; buttonUrl: string; unsubscribeToken: string | null };
  from: string; replyTo: string | null; resendKey: string;
};
export type EmailWorkerDeps = {
  readWorkerSecret(): Promise<string | null>;
  claim(limit: number): Promise<ClaimedSend[]>;
  complete(sendId: string, result: "sent" | "retry" | "failed", providerId: string | null, error: string | null): Promise<void>;
  fetch: typeof fetch;
  /** FLOWAI_APP_URL, without trailing slash. */
  appUrl: string;
  /** Receives fixed event names, send ids and codes only — never a key, address or body. */
  log?: (...args: string[]) => void;
};

const BATCH = 50;

export async function handleEmailWorker(request: Request, deps: EmailWorkerDeps): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const log = (event: string, fields: Record<string, string>) => (deps.log ?? console.error)("email-worker", event, JSON.stringify(fields));
  try {
    const secret = await deps.readWorkerSecret();
    const provided = request.headers.get("x-flowai-worker") ?? "";
    if (!secret || !provided || provided.length > 8192 || !await constantTimeTextEqual(provided, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const counts = { sent: 0, retry: 0, failed: 0 };
    // Sequential: keeps under Resend's per-second rate limit; a 429 is simply retried later.
    for (const send of await deps.claim(BATCH)) {
      let result: "sent" | "retry" | "failed", providerId: string | null = null, error: string | null = null;
      try {
        const unsubscribe = send.category === "marketing" && send.ctx.unsubscribeToken
          ? `${deps.appUrl}/e/sair/${encodeURIComponent(send.ctx.unsubscribeToken)}` : null;
        const rendered = renderEmail(send.content, { ...send.ctx, items: send.ctx.items ?? [], unsubscribeUrl: unsubscribe });
        const sent = await sendResendEmail(deps.fetch, send.resendKey, {
          from: send.from, to: send.toEmail, replyTo: send.replyTo, ...rendered,
          ...(unsubscribe ? { headers: { "List-Unsubscribe": `<${unsubscribe}/one-click>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
        }, send.sendId);
        if (sent.ok) { result = "sent"; providerId = sent.id; }
        else { result = sent.retry ? "retry" : "failed"; error = sent.code; }
      } catch { result = "failed"; error = "render_failed"; }
      try {
        await deps.complete(send.sendId, result, providerId, error);
        counts[result]++;
        log(result, { sendId: send.sendId, ...(error ? { code: error } : {}) });
      } catch { log("complete_failed", { sendId: send.sendId }); } // reclaimed after 5 min; Idempotency-Key avoids a double send
    }
    return Response.json(counts);
  } catch { return Response.json({ error: "temporarily_unavailable" }, { status: 503 }); }
}
