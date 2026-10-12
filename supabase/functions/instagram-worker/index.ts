import { createMetaRepository } from "../_shared/meta-repository.ts";
import { handleInstagramWorker, type PreparedComment, type InstagramWork } from "./handler.ts";
import type { SendClaim } from "../send-message/handler.ts";
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
  prepare: (id) => rpc<PreparedComment | null>("prepare_instagram_comment_send", { p_event_id: id }),
  reselect: (id, at) => rpc<PreparedComment | null>("reselect_instagram_comment_rule", { p_event_id: id, p_comment_at: at }),
  claim: (id) => rpc<SendClaim | null>("claim_instagram_send", { p_intent_id: id }),
  complete: (id, result) => rpc<void>("complete_instagram_send", { p_intent_id: id, p_result: result }),
  finishWork: (id, state, error) => rpc<void>("finish_instagram_work", { p_queue_id: id, p_state: state, p_error_code: error }),
  readConnectionSecrets: repository.readConnectionSecrets, verifyConnection: repository.verifyConnection, fetch, now: () => new Date(),
}));
