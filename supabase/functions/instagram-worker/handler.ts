import { sendClaimedInstagram, type SendClaim, type SendDeps } from "../send-message/handler.ts";
import { constantTimeTextEqual } from "../_shared/http.ts";
import { InstagramProvider } from "../../../packages/core/src/channels/instagram/provider.ts";
export type WorkResult = "done" | "ignored" | "retry" | "failed" | "uncertain";
export type InstagramWork = { queueId: number; eventId: string; task?: "comment" | "profile" };
export type PreparedProfile = { eventId: string; organizationId: string; channelId: string; connectionId: string; contactId: string; senderExternalId: string };
export type PreparedComment = { eventId: string; organizationId: string; channelId: string; connectionId: string; intentId: string; commentId: string; mediaId: string; senderExternalId: string; ruleEffectiveAt: string; state: string };
export type InstagramWorkerDeps = SendDeps & {
  readWorkerSecret(): Promise<string | null>;
  readWork(limit: number): Promise<InstagramWork[]>;
  prepare(eventId: string): Promise<PreparedComment | null>;
  /** Picks the oldest active matching rule already effective at the comment's real time. */
  reselect(eventId: string, commentAt: string): Promise<PreparedComment | null>;
  claim(intentId: string): Promise<SendClaim | null>;
  prepareProfile(eventId: string): Promise<PreparedProfile | null>;
  saveContactName(eventId: string, name: string): Promise<void>;
  finishWork(queueId: number, state: WorkResult, errorCode: string | null): Promise<void>;
};
/** Best-effort profile lookup after a Direct: any failure only skips the name. */
async function processInstagramProfile(item: InstagramWork, deps: InstagramWorkerDeps): Promise<WorkResult> {
  let state: WorkResult = "ignored"; let errorCode: string | null = null;
  try {
    const prepared = await deps.prepareProfile(item.eventId);
    if (prepared) {
      const secrets = await deps.readConnectionSecrets(prepared.connectionId);
      const channel = secrets?.channels.find((channel) => channel.channelId === prepared.channelId && channel.status === "active");
      if (!secrets || !channel || secrets.disconnected || secrets.organizationId !== prepared.organizationId) errorCode = "channel_inactive";
      else {
        const provider = new InstagramProvider({ accountId: channel.accountId, accessToken: channel.accessToken, apiVersion: secrets.apiVersion, fetch: deps.fetch, now: deps.now });
        const profile = await provider.getContact(prepared.senderExternalId);
        if (profile.name) { await deps.saveContactName(item.eventId, profile.name); state = "done"; }
      }
    }
  } catch { state = "ignored"; errorCode = "profile_unavailable"; }
  await deps.finishWork(item.queueId, state, errorCode);
  return state;
}
export async function processInstagramWork(item: InstagramWork, deps: InstagramWorkerDeps): Promise<WorkResult> {
  if (item.task === "profile") return await processInstagramProfile(item, deps);
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
        const commentResponse = await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/${encodeURIComponent(prepared.commentId)}?fields=id%2Ctimestamp%2Cfrom%2Cmedia%7Bid%2Cmedia_product_type%7D`, { headers, signal: AbortSignal.timeout(15000) });
        const comment = await commentResponse.json();
        if (!commentResponse.ok || comment.error) {
          errorCode = comment.error?.code === 190 ? "invalid_token" : "comment_unavailable";
          state = commentResponse.status >= 500 || commentResponse.status === 429 ? "retry" : "ignored";
          if (errorCode === "invalid_token" && deps.verifyConnection) await deps.verifyConnection(secrets.connectionId, "token", false, errorCode, secrets.generation).catch(() => {});
        } else {
          const createdAt = Date.parse(comment.timestamp);
          const now = deps.now().getTime();
          const productType = comment.media?.media_product_type;
          const eligible = Number.isFinite(createdAt) && createdAt <= now && now - createdAt < 7 * 86400000
            && String(comment.id) === prepared.commentId && String(comment.from?.id) === prepared.senderExternalId
            && String(comment.media?.id ?? "") === prepared.mediaId && (!productType || ["FEED", "REELS"].includes(productType));
          // The first rule may have been (re)activated after the comment was posted:
          // fall back to the next rule that was already effective at that time.
          let target: PreparedComment | null = prepared;
          if (eligible && createdAt < Date.parse(prepared.ruleEffectiveAt)) {
            const fallback = await deps.reselect(prepared.eventId, String(comment.timestamp));
            target = fallback && fallback.state === "pending" && createdAt >= Date.parse(fallback.ruleEffectiveAt) ? fallback : null;
          }
          if (!eligible || !target) {
            state = "ignored"; errorCode = "comment_not_eligible";
          } else {
            const mediaResponse = await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/${encodeURIComponent(prepared.mediaId)}?fields=id%2Cowner%7Bid%2Cusername%7D`, { headers, signal: AbortSignal.timeout(15000) });
            const media = await mediaResponse.json();
            const ownerId = String(media.owner?.id ?? media.owner ?? "");
            const ownerUsername = String(media.owner?.username ?? "").toLowerCase();
            const channelUsername = String(channel.username ?? "").toLowerCase();
            const owned = ownerId === channel.accountId || (channelUsername.length > 0 && ownerUsername === channelUsername);
            if (mediaResponse.status >= 500 || mediaResponse.status === 429) { state = "retry"; errorCode = "provider_unavailable"; }
            else if (!mediaResponse.ok || String(media.id) !== prepared.mediaId || !owned) { state = "ignored"; errorCode = "media_not_owned"; }
            else {
              const claim = await deps.claim(target.intentId);
              if (!claim) state = "retry";
              else {
                claimed = true;
                const result = await sendClaimedInstagram(claim, target.organizationId, deps);
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
/** Items processed in parallel; also the batch size read from the queue. */
export const WORKER_CONCURRENCY = 3;
/** Stop claiming new work after this budget (cron fires every minute; HTTP timeout is 150 s). */
export const WORKER_BUDGET_MS = 100_000;
/** Reads and processes batches until the queue is empty or the time budget is spent. */
export async function drainInstagramWork(deps: InstagramWorkerDeps, budgetMs = WORKER_BUDGET_MS): Promise<WorkResult[]> {
  const deadline = deps.now().getTime() + budgetMs;
  const results: WorkResult[] = [];
  while (deps.now().getTime() < deadline) {
    const batch = await deps.readWork(WORKER_CONCURRENCY);
    if (batch.length === 0) break;
    // Each item acknowledges itself; if an acknowledgement fails the batch rejects
    // and the unacknowledged items reappear after their visibility timeout.
    results.push(...await Promise.all(batch.map((item) => processInstagramWork(item, deps))));
  }
  return results;
}
export async function handleInstagramWorker(request: Request, deps: InstagramWorkerDeps): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  try {
    const secret = await deps.readWorkerSecret();
    const provided = request.headers.get("x-flowai-worker") ?? "";
    if (!secret || !provided || provided.length > 8192 || !await constantTimeTextEqual(provided, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
    const results = await drainInstagramWork(deps);
    return Response.json({ processed: results.length, results });
  } catch { return Response.json({ error: "temporarily_unavailable" }, { status: 503 }); }
}
