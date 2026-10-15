import type { Authorize } from "../_shared/auth.ts";
import { RepositoryError, type MetaConnectionRepository } from "../_shared/meta-repository.ts";
import { BodyTooLarge, readLimitedBody } from "../_shared/http.ts";

export type MetaConnectionDeps = {
  authorize: Authorize; repository: MetaConnectionRepository; fetch: typeof fetch;
  /** Receives fixed tokens and codes only (no PII); defaults to console.warn. */
  log?: (...args: string[]) => void;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const instagramUsername = /^[A-Za-z0-9._]{1,30}$/;
function json(data: unknown, status = 200): Response { return Response.json(data, { status, headers: { "Cache-Control": "no-store" } }); }

export async function handleMetaConnection(request: Request, deps: MetaConnectionDeps): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    let input: Record<string, unknown>;
    try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readLimitedBody(request, 32768))); }
    catch (error) { return error instanceof BodyTooLarge ? json({ error: "body_too_large" }, 413) : json({ error: "invalid_input" }, 400); }
    if (!input || typeof input !== "object" || typeof input.organizationId !== "string" || !uuid.test(input.organizationId)) return json({ error: "invalid_input" }, 400);
    const actor = await deps.authorize(request, input.organizationId, "admin");
    if (!actor) return json({ error: "forbidden" }, 403);
    if (input.action === "save") {
      if (!input.input || typeof input.input !== "object" || Array.isArray(input.input)) return json({ error: "invalid_input" }, 400);
      const result = await deps.repository.saveConnection(actor.userId, input.organizationId, input.input as Record<string, unknown>);
      return json({ connectionId: result.connectionId, channelId: result.channelId });
    }
    if (typeof input.connectionId !== "string" || !uuid.test(input.connectionId)) return json({ error: "invalid_input" }, 400);
    // Ownership and role are enforced by the service RPC itself; a removed
    // connection may no longer have readable secrets.
    if (input.action === "remove") {
      const removed = await deps.repository.removeConnection(actor.userId, input.organizationId, input.connectionId);
      return json({ removed: removed.removed === true, disconnected: removed.disconnected === true });
    }
    const secrets = await deps.repository.readConnectionSecrets(input.connectionId);
    if (!secrets || secrets.organizationId !== input.organizationId) return json({ error: "forbidden" }, 403);
    if (input.action === "disconnect") {
      await deps.repository.disconnectConnection(actor.userId, input.organizationId, input.connectionId);
      return json({ disconnected: true });
    }
    if (secrets.disconnected) return json({ error: "connection_disconnected" }, 409);
    if (input.action === "reveal_verify_token") return json({ verifyToken: secrets.verifyToken });
    if (input.action === "verify_vip") {
      const channel=secrets.channels.find(item=>item.channelId===input.channelId);
      if (!channel) return json({error:"forbidden"},403);
      if (!deps.repository.recordVipCapability) return json({error:"operation_failed"},503);
      let errorCode: string | null="comments_permission_required";
      try {
        const headers={Authorization:`Bearer ${channel.accessToken}`};
        const identityResponse=await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/me?fields=user_id%2Cusername`,{headers,signal:AbortSignal.timeout(15000)});
        const identity=await identityResponse.json();
        if (!identityResponse.ok || identity.error) errorCode=identity.error?.code===190 ? "invalid_token" : "comments_permission_required";
        else if (String(identity.user_id ?? "")!==channel.accountId || typeof identity.username!=="string" || !instagramUsername.test(identity.username)) errorCode="invalid_account";
        else {
          const response=await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/me/permissions`,{headers,signal:AbortSignal.timeout(15000)});
          const permissions=await response.json();
          const scopes=new Set(Array.isArray(permissions.data) ? permissions.data.filter((entry: {status?: string})=>entry.status==="granted").map((entry: {permission?: string})=>entry.permission) : []);
          if (response.ok && !permissions.error && scopes.has("instagram_business_manage_comments") && scopes.has("instagram_business_manage_messages")) {
            await deps.repository.recordInstagramUsername(channel.channelId,identity.username);
            errorCode=null;
          } else if (permissions.error?.code===190) errorCode="invalid_token";
        }
      } catch { errorCode="provider_unavailable"; }
      await deps.repository.recordVipCapability(channel.channelId,secrets.generation,errorCode===null,errorCode);
      return errorCode ? json({error:errorCode},422) : json({verified:true});
    }
    if (input.action === "validate_media") {
      if (typeof input.mediaId !== "string" || !/^\d{1,100}$/.test(input.mediaId)) return json({ error: "invalid_input" }, 400);
      const channel = secrets.channels.find((item) => item.channelId === input.channelId);
      if (!channel) return json({ error: "forbidden" }, 403);
      const response = await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/${input.mediaId}?fields=id%2Cowner%7Bid%2Cusername%7D`, { headers: { Authorization: `Bearer ${channel.accessToken}` }, signal: AbortSignal.timeout(15000) });
      const media = await response.json();
      const ownerId = String(media.owner?.id ?? media.owner ?? "");
      const ownerUsername = String(media.owner?.username ?? "").toLowerCase();
      const channelUsername = String(channel.username ?? "").toLowerCase();
      const owned = ownerId === channel.accountId || (channelUsername.length > 0 && ownerUsername === channelUsername);
      if (!response.ok || String(media.id) !== input.mediaId || !owned) return json({ error: "media_not_owned" }, 422);
      await deps.repository.verifyMedia(secrets.connectionId, channel.channelId, input.mediaId, secrets.generation);
      return json({ verified: true, mediaId: input.mediaId });
    }
    if (input.action !== "test") return json({ error: "invalid_action" }, 400);
    const channel = secrets.channels[0];
    if (!channel) return json({ error: "invalid_account" }, 422);
    let errorCode: string | null = null;
    let username: string | null = null;
    try {
      const headers = { Authorization: `Bearer ${channel.accessToken}`, "Content-Type": "application/json" };
      const profileResponse = await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/me?fields=user_id%2Cusername`, { headers, signal: AbortSignal.timeout(15000) });
      const profile = await profileResponse.json();
      if (!profileResponse.ok || profile.error) errorCode = profile.error?.code === 190 ? "invalid_token" : "permission_denied";
      else if (String(profile.user_id ?? "") !== channel.accountId) errorCode = "invalid_account";
      else {
        username = typeof profile.username === "string" ? profile.username : null;
        const subscriptionResponse = await deps.fetch(`https://graph.instagram.com/${secrets.apiVersion}/${channel.accountId}/subscribed_apps`, { method: "POST", headers, body: JSON.stringify({ subscribed_fields: ["messages", "comments", "messaging_seen"] }), signal: AbortSignal.timeout(15000) });
        const subscription = await subscriptionResponse.json();
        if (!subscriptionResponse.ok || subscription.success !== true) errorCode = subscription.error?.code === 190 ? "invalid_token" : "permission_denied";
      }
    } catch { errorCode = "provider_unavailable"; }
    await deps.repository.verifyConnection(secrets.connectionId, "token", errorCode === null, errorCode, secrets.generation);
    // Usuário da conta (link ig.me): melhor esforço; se faltar, o admin informa em Canais.
    if (errorCode === null && username !== null && instagramUsername.test(username)) {
      try { await deps.repository.recordInstagramUsername(channel.channelId, username); }
      catch (error) {
        const code = error instanceof RepositoryError ? error.code : "unknown";
        (deps.log ?? console.warn)("meta-connection", "instagram_username_record_failed", code);
      }
    }
    return errorCode ? json({ error: errorCode }, 422) : json({ verified: true, accountId: channel.accountId, username });
  } catch (error) {
    if (error instanceof RepositoryError) {
      if (error.code === "23505") return json({ error: error.hint === "same_organization" ? "app_already_connected" : "already_connected" }, 409);
      if (error.code === "40001") return json({ error: "credentials_changed" }, 409);
      if (error.code === "42501") return json({ error: "forbidden" }, 403);
      return json({ error: "operation_failed" }, 422);
    }
    return json({ error: "operation_failed" }, 503);
  }
}
