export type ResendMessage = {
  from: string; to: string; replyTo?: string | null; subject: string; html: string; text: string; headers?: Record<string, string>;
};
export type ResendResult = { ok: true; id: string } | { ok: false; retry: boolean; code: string };

/** Never returns or throws provider text: only fixed codes leave here (the body may echo the key or recipient). */
export async function sendResendEmail(fetcher: typeof fetch, key: string, msg: ResendMessage, idempotencyKey: string): Promise<ResendResult> {
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}), ...(msg.headers ? { headers: msg.headers } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { /* malformed reply */ }
    if (response.ok) {
      const id = (body as { id?: unknown } | null)?.id;
      return typeof id === "string" && id ? { ok: true, id } : { ok: false, retry: true, code: "invalid_response" };
    }
    // Only the error name is read: same key still in flight → retry later; same key, other payload → never.
    const name = (body as { name?: unknown } | null)?.name;
    if (response.status === 409 && name === "concurrent_idempotent_requests") return { ok: false, retry: true, code: "idempotency_in_flight" };
    if (response.status === 409 && name === "invalid_idempotent_request") return { ok: false, retry: false, code: "idempotency_conflict" };
    return { ok: false, retry: response.status === 429 || response.status >= 500, code: `http_${response.status}` };
  } catch { return { ok: false, retry: true, code: "network_error" }; }
}
