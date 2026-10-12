import { InstagramProvider } from "../../../packages/core/src/channels/instagram/provider.ts";
import { InstagramError } from "../../../packages/core/src/channels/instagram/errors.ts";
import type { MetaSecrets, MetaConnectionRepository } from "../_shared/meta-repository.ts";
import type { Authorize } from "../_shared/auth.ts";
import { BodyTooLarge, readLimitedBody } from "../_shared/http.ts";

export type SendClaim = { intentId: string; connectionId: string; channelId: string; kind: "direct" | "private_reply"; text: string; recipientExternalId: string | null; commentId: string | null; claimToken: string };
export type SendResult = { state: "sent" | "failed" | "uncertain"; claimToken: string; externalId?: string; recipientId?: string; errorCode?: string };
export type SendIntent = { id: string; organizationId: string; actorId: string | null; messageId: string | null; state: string; kind: string };
export type SendDeps = {
  readConnectionSecrets(id: string): Promise<MetaSecrets | null>;
  complete(id: string, result: SendResult): Promise<void>;
  fetch: typeof fetch; now: () => Date;
  verifyConnection?: MetaConnectionRepository["verifyConnection"];
};
export type SendMessageDeps = SendDeps & { authorize: Authorize; readIntent(id: string): Promise<SendIntent | null>; claim(id: string): Promise<SendClaim | null> };

/** Shared transport for authenticated replies and already-authorized worker claims. */
export async function sendClaimedInstagram(claim: SendClaim, organizationId: string, deps: SendDeps): Promise<SendResult> {
  let result: SendResult;
  let secrets: MetaSecrets | null = null;
  try {
    secrets = await deps.readConnectionSecrets(claim.connectionId);
    if (!secrets || secrets.disconnected || secrets.organizationId !== organizationId) throw new InstagramError("invalid_config", "rejected");
    const channel = secrets.channels.find((channel) => channel.channelId === claim.channelId && channel.status === "active");
    if (!channel) throw new InstagramError("invalid_config", "rejected");
    const provider = new InstagramProvider({ accountId: channel.accountId, accessToken: channel.accessToken, apiVersion: secrets.apiVersion, fetch: deps.fetch, now: deps.now });
    const sent = claim.kind === "private_reply"
      ? await provider.sendPrivateReply(claim.commentId ?? "", claim.text)
      : await provider.sendMessage({ externalId: claim.recipientExternalId ?? "" }, { text: claim.text });
    result = { state: "sent", claimToken: claim.claimToken, externalId: sent.externalId, ...("recipientId" in sent && typeof sent.recipientId === "string" ? { recipientId: sent.recipientId } : {}) };
  } catch (error) {
    if (error instanceof InstagramError && error.code === "invalid_token" && secrets && deps.verifyConnection) {
      await deps.verifyConnection(secrets.connectionId, "token", false, "invalid_token", secrets.generation).catch(() => {});
    }
    result = { state: error instanceof InstagramError && error.certainty === "rejected" ? "failed" : "uncertain", claimToken: claim.claimToken, errorCode: error instanceof InstagramError ? error.code : "operation_failed" };
  }
  // A failure to persist AFTER an external send propagates; its lease becomes
  // uncertain. It must never be translated into a safe-to-retry rejection.
  await deps.complete(claim.intentId, result);
  return result;
}

function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }
export async function handleSendMessage(request: Request, deps: SendMessageDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    let input: { intentId?: unknown };
    try { input = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 4096))); }
    catch (error) { return json({ error: "invalid_input" }, error instanceof BodyTooLarge ? 413 : 400); }
    if (!input || typeof input.intentId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.intentId)) return json({ error: "invalid_input" }, 400);
    const intent = await deps.readIntent(input.intentId);
    if (!intent || intent.kind !== "direct") return json({ error: "forbidden" }, 403);
    const actor = await deps.authorize(request, intent.organizationId, "agent");
    if (!actor || actor.userId !== intent.actorId) return json({ error: "forbidden" }, 403);
    if (["sent", "failed", "uncertain"].includes(intent.state)) return json({ state: intent.state, messageId: intent.messageId });
    const claim = await deps.claim(intent.id);
    if (!claim) {
      const current = await deps.readIntent(intent.id);
      return current && ["sent", "failed", "uncertain"].includes(current.state) ? json({ state: current.state, messageId: current.messageId }) : json({ error: "already_sending" }, 409);
    }
    const result = await sendClaimedInstagram(claim, intent.organizationId, deps);
    return json({ state: result.state, messageId: intent.messageId });
  } catch { return json({ error: "temporarily_unavailable" }, 503); }
}
