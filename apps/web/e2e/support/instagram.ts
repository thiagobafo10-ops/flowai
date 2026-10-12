import { createHmac } from "node:crypto";
import { psql } from "./local-db";

export const INSTAGRAM_TEST_URL = "http://127.0.0.1:54326";
export function connectionFor(email: string) {
  if (!/^[\w.+@-]+$/.test(email)) throw new Error("Invalid fixture email");
  return JSON.parse(psql(`select json_build_object('id',mc.id,'channelId',ch.id,'accountId',ch.external_account_id,'verifyToken',v.decrypted_secret) from public.meta_connections mc join public.channels ch on ch.meta_connection_id=mc.id join public.memberships m on m.organization_id=mc.organization_id join auth.users u on u.id=m.user_id join vault.decrypted_secrets v on v.id=mc.verify_token_secret_id where u.email='${email}' limit 1`)) as { id: string; channelId: string; accountId: string; verifyToken: string };
}
export async function confirmWebhook(email: string) {
  const c = connectionFor(email);
  const url = `${INSTAGRAM_TEST_URL}/functions/v1/meta-webhook/${c.id}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(c.verifyToken)}&hub.challenge=test`;
  const response = await fetch(url); if (response.status !== 200) throw new Error("Webhook confirmation failed");
}
export async function sendInstagramEvent(email: string, message: Record<string, unknown>, sender = "90001", sentAt = Date.now()) {
  const c = connectionFor(email);
  const body = JSON.stringify({ object: "instagram", entry: [{ id: c.accountId, time: Math.floor(sentAt / 1000), messaging: [{ sender: { id: sender }, recipient: { id: c.accountId }, timestamp: sentAt, message }] }] });
  return postSigned(c.id, body);
}
export async function sendInstagramComment(email: string, commentId: string, text: string) {
  const c = connectionFor(email);
  const body = JSON.stringify({ object: "instagram", entry: [{ id: c.accountId, time: Math.floor(Date.now() / 1000), changes: [{ field: "comments", value: { id: commentId, from: { id: "90002", username: "cliente_comentario" }, text, media: { id: "80001", media_product_type: "REELS" } } }] }] });
  return postSigned(c.id, body);
}
async function postSigned(id: string, body: string) {
  const signature = createHmac("sha256", "e2e-app-secret").update(body).digest("hex");
  const response = await fetch(`${INSTAGRAM_TEST_URL}/functions/v1/meta-webhook/${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${signature}` }, body });
  if (response.status !== 200) throw new Error(`Signed fixture failed: ${response.status}`);
}
export async function runInstagramWorker() {
  const response = await fetch(`${INSTAGRAM_TEST_URL}/__test__/run-worker`, { method: "POST" });
  if (!response.ok) throw new Error("Worker fixture failed");
}
