import { createMetaRepository } from "../_shared/meta-repository.ts";
import { handleInstagramWorker, type PreparedComment, type PreparedProfile, type InstagramWork } from "./handler.ts";
import type { SendClaim } from "../send-message/handler.ts";
import type { VipClaim, VipPrepared } from "./vip.ts";
import type { PublicReplyClaim, PublicReplyPrepared } from "./public-reply.ts";
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const repository = createMetaRepository(url, key, fetch);
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Database operation failed");
  const text = await response.text(); return (text ? JSON.parse(text) : undefined) as T;
}
Deno.serve((request) => handleInstagramWorker(request, {
  readWorkerSecret: async () => (await rpc<{ workerSecret: string } | null>("read_instagram_worker_config", {}))?.workerSecret ?? null,
  readWork: (limit) => rpc<InstagramWork[]>("read_instagram_work", { p_limit: limit }),
  prepareVip: (id) => rpc<VipPrepared | null>("prepare_instagram_vip_send", { p_event_id: id }),
  claimVip: (id, at, text, connectionId, generation) => rpc<VipClaim | null>("claim_instagram_vip_send", { p_intent_id: id, p_comment_at: at, p_comment_text: text, p_expected_connection_id: connectionId, p_expected_generation: generation }),
  completeVip: (id, token, state, externalId, errorCode) => rpc<void>("complete_instagram_vip_send", { p_intent_id: id, p_claim_token: token, p_state: state, p_external_id: externalId, p_error_code: errorCode }),
  finishVipWork: (id, state, errorCode, connectionId, generation) => rpc<void>("finish_instagram_vip_work", { p_queue_id: id, p_state: state, p_error_code: errorCode, p_expected_connection_id: connectionId, p_expected_generation: generation }),
  preparePublicReply: (id) => rpc<PublicReplyPrepared | null>("prepare_instagram_comment_public_reply", { p_event_id: id }),
  claimPublicReply: (id, at, connectionId, generation) => rpc<PublicReplyClaim | null>("claim_instagram_comment_public_reply", { p_reply_id: id, p_comment_at: at, p_expected_connection_id: connectionId, p_expected_generation: generation }),
  completePublicReply: (id, token, state, externalId, errorCode) => rpc<void>("complete_instagram_comment_public_reply", { p_reply_id: id, p_claim_token: token, p_state: state, p_external_id: externalId, p_error_code: errorCode }),
  finishPublicReplyWork: (id, state, errorCode) => rpc<void>("finish_instagram_comment_public_reply_work", { p_queue_id: id, p_state: state, p_error_code: errorCode }),
  prepare: (id) => rpc<PreparedComment | null>("prepare_instagram_comment_send", { p_event_id: id }),
  reselect: (id, at) => rpc<PreparedComment | null>("reselect_instagram_comment_rule", { p_event_id: id, p_comment_at: at }),
  prepareProfile: (id) => rpc<PreparedProfile | null>("prepare_instagram_profile", { p_event_id: id }),
  saveContactName: (id, name) => rpc<void>("save_instagram_contact_name", { p_event_id: id, p_name: name }),
  claim: (id) => rpc<SendClaim | null>("claim_instagram_send", { p_intent_id: id }),
  complete: (id, result) => rpc<void>("complete_instagram_send", { p_intent_id: id, p_result: result }),
  finishWork: (id, state, error) => rpc<void>("finish_instagram_work", { p_queue_id: id, p_state: state, p_error_code: error }),
  readConnectionSecrets: repository.readConnectionSecrets, verifyConnection: repository.verifyConnection, fetch, now: () => new Date(),
}));
