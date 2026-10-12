import { sendClaimedInstagram, type SendClaim, type SendDeps } from "../send-message/handler.ts";
import { constantTimeTextEqual } from "../_shared/http.ts";
export type WorkResult = "done" | "ignored" | "retry" | "failed" | "uncertain";
export type InstagramWork = { queueId: number; eventId: string };
export type PreparedComment = { eventId: string; organizationId: string; channelId: string; connectionId: string; intentId: string; commentId: string; mediaId: string; senderExternalId: string; ruleEffectiveAt: string; state: string };
export type InstagramWorkerDeps = SendDeps & {
  readWorkerSecret(): Promise<string | null>;
  readWork(limit: number): Promise<InstagramWork[]>;
  prepare(eventId: string): Promise<PreparedComment | null>;
  claim(intentId: string): Promise<SendClaim | null>;
  finishWork(queueId: number, state: WorkResult, errorCode: string | null): Promise<void>;
};
export async function processInstagramWork(item: InstagramWork, deps: InstagramWorkerDeps): Promise<WorkResult> {
  let state: WorkResult = "ignored"; let errorCode: string | null = null;
  let claimed = false;
  try {
    const prepared = await deps.prepare(item.eventId);
    if (!prepared) state = "ignored";
    else if (prepared.state === "sent") state = "done";
    else if (prepared.state === "uncertain") state = "uncertain";
    else if (prepared.state === "sending") state = "retry";
    else {
      const secrets = await deps.readConnectionSecrets(prepared.connectionId);
      const channel = secrets?.channels.find((channel) => channel.channelId === prepared.channelId && channel.status === "active");
      if (!secrets || !channel || secrets.disconnected || secrets.organizationId !== prepared.organizationId) { state = "ignored"; errorCode = "channel_inactive"; }
      else {
        const headers = { Authorization: `Bearer ${channel.accessToken}` };
        const commentResponse = await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/${encodeURIComponent(prepared.commentId)}?fields=id%2Ctimestamp%2Cfrom%2Cmedia`, { headers, signal: AbortSignal.timeout(15000) });
        const comment = await commentResponse.json();
        if (!commentResponse.ok || comment.error) {
          errorCode = comment.error?.code === 190 ? "invalid_token" : "comment_unavailable";
          state = commentResponse.status >= 500 || commentResponse.status === 429 ? "retry" : "ignored";
          if (errorCode === "invalid_token" && deps.verifyConnection) await deps.verifyConnection(secrets.connectionId, "token", false, errorCode, secrets.generation).catch(() => {});
        } else {
          const createdAt = Date.parse(comment.timestamp);
          const now = deps.now().getTime();
          if (!Number.isFinite(createdAt) || createdAt > now || now - createdAt >= 7 * 86400000 || createdAt < Date.parse(prepared.ruleEffectiveAt)
            || String(comment.id) !== prepared.commentId || String(comment.from?.id) !== prepared.senderExternalId
            || String(comment.media?.id) !== prepared.mediaId || !["FEED", "REELS"].includes(comment.media?.media_product_type)) {
            state = "ignored"; errorCode = "comment_not_eligible";
          } else {
            const mediaResponse = await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/${encodeURIComponent(prepared.mediaId)}?fields=id%2Cowner`, { headers, signal: AbortSignal.timeout(15000) });
            const media = await mediaResponse.json();
            if (mediaResponse.status >= 500 || mediaResponse.status === 429) { state = "retry"; errorCode = "provider_unavailable"; }
            else if (!mediaResponse.ok || String(media.id) !== prepared.mediaId || String(media.owner?.id ?? media.owner ?? "") !== channel.accountId) { state = "ignored"; errorCode = "media_not_owned"; }
            else {
              const claim = await deps.claim(prepared.intentId);
              if (!claim) state = "retry";
              else {
                claimed = true;
                const result = await sendClaimedInstagram(claim, prepared.organizationId, deps);
                state = result.state === "sent" ? "done" : result.state === "uncertain" ? "uncertain" : result.errorCode === "rate_limited" ? "retry" : "failed";
                errorCode = result.errorCode ?? null;
              }
            }
          }
        }
      }
    }
  } catch { state = claimed ? "uncertain" : "retry"; errorCode = "operation_failed"; }
  await deps.finishWork(item.queueId, state, errorCode);
  return state;
}
export async function handleInstagramWorker(request: Request, deps: InstagramWorkerDeps): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  try {
    const secret = await deps.readWorkerSecret();
    const provided = request.headers.get("x-flowai-worker") ?? "";
    if (!secret || !provided || provided.length > 8192 || !await constantTimeTextEqual(provided, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const work = await deps.readWork(5);
    const results: WorkResult[] = [];
    for (const item of work) results.push(await processInstagramWork(item, deps));
    return Response.json({ processed: results.length, results });
  } catch { return Response.json({ error: "temporarily_unavailable" }, { status: 503 }); }
}
