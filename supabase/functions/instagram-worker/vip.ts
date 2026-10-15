import type { MetaSecrets } from "../_shared/meta-repository.ts";
import type { InstagramWork, WorkResult } from "./handler.ts";
import { InstagramProvider } from "../../../packages/core/src/channels/instagram/provider.ts";
import { InstagramError } from "../../../packages/core/src/channels/instagram/errors.ts";
export type VipPrepared = { eventId: string; organizationId: string; channelId: string; connectionId: string; commentId: string; mediaId: string; senderExternalId: string; activatedAt: string; operations: { id: string; kind: "public" | "private"; state: string }[] };
export type VipClaim = { id: string; claimToken: string; kind: "public" | "private"; text: string };
export type VipDeps = {
 prepareVip(id: string): Promise<VipPrepared | null>;
 claimVip(id: string, commentAt: string, commentText: string, connectionId: string, generation: number): Promise<VipClaim | null>;
 completeVip(id: string, token: string, state: string, externalId: string | null, errorCode: string | null): Promise<void>;
 finishVipWork(id: number, state: WorkResult, errorCode: string | null, connectionId: string | null, generation: number | null): Promise<void>;
 readConnectionSecrets(id: string): Promise<MetaSecrets | null>;
 fetch: typeof fetch; now(): Date;
};
/** VIP queue acknowledgement never mutates the legacy automation event state. */
export async function processInstagramVipWork(item: Pick<InstagramWork, "queueId" | "eventId">, deps: VipDeps): Promise<WorkResult> {
 let state: WorkResult = "ignored"; let errorCode: string | null = null;
 let connectionId: string | null=null; let generation: number | null=null;
 const finish=(result: WorkResult, code: string | null)=>deps.finishVipWork(item.queueId,result,code,connectionId,generation);
 try {
  const prepared = await deps.prepareVip(item.eventId);
  if (!prepared) { await finish(state,null); return state; }
  const secrets = await deps.readConnectionSecrets(prepared.connectionId);
  if (secrets) { connectionId=secrets.connectionId; generation=secrets.generation; }
  const channel = secrets?.channels.find(c => c.channelId === prepared.channelId && c.status === "active");
  if (!secrets || !channel || secrets.disconnected || secrets.organizationId !== prepared.organizationId) {
   await finish(state,"channel_inactive"); return state;
  }
  const get = async (path: string) => {
   const response = await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/${path}`, { headers: { Authorization: `Bearer ${channel.accessToken}` }, signal: AbortSignal.timeout(15000) });
   const body = await response.json();
   if (!response.ok || body.error) throw new InstagramError(body.error?.code === 190 ? "invalid_token" : body.error?.code === 10 || body.error?.code === 200 ? "permission_denied" : response.status === 429 ? "rate_limited" : "provider_rejected", response.status >= 500 ? "uncertain" : "rejected");
   return body;
  };
  // Query the official identity to handle IDs scoped differently in comment webhooks.
  const identity = await get("me?fields=user_id%2Cusername");
  const ownUsername = typeof identity.username === "string" ? identity.username.toLowerCase() : "";
  if (String(identity.user_id ?? "") !== channel.accountId || !ownUsername) {
   await finish(state,"invalid_account"); return state;
  }
  const comment = await get(`${encodeURIComponent(prepared.commentId)}?fields=id%2Ctimestamp%2Ctext%2Cfrom%2Cusername%2Cparent_id%2Cmedia%7Bid%2Cmedia_product_type%7D`);
  const authorId = String(comment.from?.id ?? "");
  const authorName = String(comment.from?.username ?? comment.username ?? "").toLowerCase();
  const createdAt = Date.parse(comment.timestamp); const now = deps.now().getTime();
  const eligible = String(comment.id) === prepared.commentId && String(comment.media?.id ?? "") === prepared.mediaId
   && authorId === prepared.senderExternalId && !!authorName && authorId !== channel.accountId && authorName !== ownUsername
   && Number.isFinite(createdAt) && createdAt <= now && createdAt >= Date.parse(prepared.activatedAt)
   && (!comment.media?.media_product_type || ["FEED","REELS"].includes(comment.media.media_product_type));
  if (!eligible) { await finish(state,"comment_not_eligible"); return state; }
  const media = await get(`${encodeURIComponent(prepared.mediaId)}?fields=id%2Cowner%7Bid%2Cusername%7D`);
  const owned = String(media.owner?.id ?? media.owner ?? "") === channel.accountId || String(media.owner?.username ?? "").toLowerCase() === ownUsername;
  if (String(media.id) !== prepared.mediaId || !owned) { await finish(state,"media_not_owned"); return state; }
  const provider = new InstagramProvider({ accountId: channel.accountId, accessToken: channel.accessToken, apiVersion: secrets.apiVersion, fetch: deps.fetch, now: deps.now });
  let retry=false; let uncertain=false; let failed=false; let sent=false;
  for (const operation of prepared.operations) {
   if (operation.state === "sent") { sent=true; continue; }
   if (operation.state === "uncertain") { uncertain=true; continue; }
   if (operation.state === "sending") { retry=true; continue; }
   if (operation.state !== "pending") continue;
   const text=typeof comment.text === "string" ? comment.text : "";
   if (operation.kind === "private" && (!/(^|[^\p{L}\p{N}_])VIP([^\p{L}\p{N}_]|$)/iu.test(text) || now-createdAt>=7*86400000)) continue;
   const claim=await deps.claimVip(operation.id,String(comment.timestamp),text,secrets.connectionId,secrets.generation);
   if (!claim) continue;
   try {
    const result=claim.kind === "public" ? await provider.sendPublicReply(prepared.commentId,claim.text) : await provider.sendPrivateReply(prepared.commentId,claim.text);
    await deps.completeVip(claim.id,claim.claimToken,"sent",result.externalId,null); sent=true;
   } catch(error) {
    const code=error instanceof InstagramError ? error.code : "operation_failed";
    const outcome=error instanceof InstagramError && error.certainty === "rejected" ? code === "rate_limited" ? "pending" : "failed" : "uncertain";
    await deps.completeVip(claim.id,claim.claimToken,outcome,null,code);
    retry ||= outcome === "pending"; uncertain ||= outcome === "uncertain"; failed ||= outcome === "failed"; errorCode=code;
   }
  }
  state=retry ? "retry" : uncertain ? "uncertain" : failed ? "failed" : sent ? "done" : "ignored";
 } catch(error) {
  const code=error instanceof InstagramError ? error.code : "provider_unavailable";
  state=code === "invalid_token" || code === "permission_denied" ? "failed" : "retry"; errorCode=code;
 }
 await finish(state,errorCode);
 return state;
}

