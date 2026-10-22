import type { MetaSecrets } from "../_shared/meta-repository.ts";
import type { InstagramWork, WorkResult } from "./handler.ts";
import { InstagramProvider } from "../../../packages/core/src/channels/instagram/provider.ts";
import { InstagramError } from "../../../packages/core/src/channels/instagram/errors.ts";
export type PublicReplyPrepared = { replyId: string; eventId: string; organizationId: string; channelId: string; connectionId: string; commentId: string; mediaId: string; originalMediaId?: string | null; senderExternalId: string; ruleEffectiveAt: string; state: string };
export type PublicReplyClaim = { id: string; claimToken: string; text: string };
export type PublicReplyDeps = {
  preparePublicReply(eventId: string): Promise<PublicReplyPrepared | null>;
  claimPublicReply(id: string, commentAt: string, connectionId: string, generation: number): Promise<PublicReplyClaim | null>;
  completePublicReply(id: string, token: string, state: "sent" | "failed" | "uncertain" | "pending", externalId: string | null, errorCode: string | null): Promise<void>;
  finishPublicReplyWork(queueId: number, state: WorkResult, errorCode: string | null): Promise<void>;
  readConnectionSecrets(id: string): Promise<MetaSecrets | null>;
  fetch: typeof fetch; now(): Date;
};
/**
 * Resposta pública ao comentário que disparou a automação. Fila e estado próprios:
 * nunca altera o evento nem a resposta privada (Direct), e vice-versa.
 */
export async function processInstagramPublicReplyWork(item: Pick<InstagramWork, "queueId" | "eventId">, deps: PublicReplyDeps): Promise<WorkResult> {
  let state: WorkResult = "ignored"; let errorCode: string | null = null;
  let claimed = false;
  try {
    const prepared = await deps.preparePublicReply(item.eventId);
    if (!prepared) state = "ignored";
    else if (prepared.state === "sent") state = "done";
    else if (prepared.state === "uncertain") state = "uncertain";
    else if (prepared.state === "sending") state = "retry";
    else if (prepared.state !== "pending") state = "ignored";
    else {
      const secrets = await deps.readConnectionSecrets(prepared.connectionId);
      const channel = secrets?.channels.find((c) => c.channelId === prepared.channelId && c.status === "active");
      if (!secrets || !channel || secrets.disconnected || secrets.organizationId !== prepared.organizationId) { state = "ignored"; errorCode = "channel_inactive"; }
      else {
        const get = async (path: string) => {
          const response = await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/${path}`, { headers: { Authorization: `Bearer ${channel.accessToken}` }, signal: AbortSignal.timeout(15000) });
          const body = await response.json();
          if (!response.ok || body.error) throw new InstagramError(body.error?.code === 190 ? "invalid_token" : body.error?.code === 10 || body.error?.code === 200 ? "permission_denied" : response.status === 429 ? "rate_limited" : "provider_rejected", response.status >= 500 ? "uncertain" : "rejected");
          return body;
        };
        const comment = await get(`${encodeURIComponent(prepared.commentId)}?fields=id%2Ctimestamp%2Cfrom%2Cusername%2Cmedia%7Bid%2Cmedia_product_type%7D`);
        const createdAt = Date.parse(comment.timestamp); const now = deps.now().getTime();
        const authorId = String(comment.from?.id ?? "");
        const authorName = String(comment.from?.username ?? comment.username ?? "").toLowerCase();
        const ownUsername = String(channel.username ?? "").toLowerCase();
        // Ad/boosted comments report the ad-scoped media id; the original (organic) media id comes alongside it.
        const expectedMediaIds = [prepared.mediaId, prepared.originalMediaId].filter((id): id is string => typeof id === "string" && id.length > 0);
        const eligible = String(comment.id) === prepared.commentId && authorId === prepared.senderExternalId
          && authorId !== channel.accountId && !(ownUsername && authorName === ownUsername)
          && expectedMediaIds.includes(String(comment.media?.id ?? ""))
          && (!comment.media?.media_product_type || ["FEED", "REELS", "AD"].includes(comment.media.media_product_type))
          && Number.isFinite(createdAt) && createdAt <= now && createdAt >= Date.parse(prepared.ruleEffectiveAt);
        if (!eligible) { state = "ignored"; errorCode = "comment_not_eligible"; }
        else {
          const ownershipMediaId = prepared.originalMediaId && prepared.originalMediaId.length > 0 ? prepared.originalMediaId : prepared.mediaId;
          const media = await get(`${encodeURIComponent(ownershipMediaId)}?fields=id%2Cowner%7Bid%2Cusername%7D`);
          const owned = String(media.owner?.id ?? media.owner ?? "") === channel.accountId || (ownUsername.length > 0 && String(media.owner?.username ?? "").toLowerCase() === ownUsername);
          if (String(media.id) !== ownershipMediaId || !owned) { state = "ignored"; errorCode = "media_not_owned"; }
          else {
            const claim = await deps.claimPublicReply(prepared.replyId, String(comment.timestamp), secrets.connectionId, secrets.generation);
            if (!claim) { state = "ignored"; errorCode = "claim_rejected"; }
            else {
              claimed = true;
              const provider = new InstagramProvider({ accountId: channel.accountId, accessToken: channel.accessToken, apiVersion: secrets.apiVersion, fetch: deps.fetch, now: deps.now });
              try {
                const result = await provider.sendPublicReply(prepared.commentId, claim.text);
                await deps.completePublicReply(claim.id, claim.claimToken, "sent", result.externalId, null);
                state = "done";
              } catch (error) {
                const code = error instanceof InstagramError ? error.code : "operation_failed";
                const outcome = error instanceof InstagramError && error.certainty === "rejected" ? code === "rate_limited" ? "pending" : "failed" : "uncertain";
                await deps.completePublicReply(claim.id, claim.claimToken, outcome, null, code);
                state = outcome === "pending" ? "retry" : outcome; errorCode = code;
              }
            }
          }
        }
      }
    }
  } catch (error) {
    // Metadata lookups never post; after the claim an unknown failure is never retried.
    const code = error instanceof InstagramError ? error.code : claimed ? "operation_failed" : "provider_unavailable";
    state = claimed ? "uncertain" : code === "invalid_token" || code === "permission_denied" ? "failed" : "retry"; errorCode = code;
  }
  await deps.finishPublicReplyWork(item.queueId, state, errorCode);
  return state;
}
