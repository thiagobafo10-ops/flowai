import { createHmac } from "node:crypto";
import { psql } from "./local-db";
import { expect, type Page } from "@playwright/test";
import { gotoReady } from "./nav";

export const INSTAGRAM_TEST_URL = process.env.FLOWAI_E2E_PROXY_URL ?? "http://127.0.0.1:54326";
export async function connectInstagram(page: Page) {
  await gotoReady(page, "/configuracoes/canais");
  await page.getByLabel("Nome do canal Instagram").fill("Minha conta");
  const account = String(Date.now());
  await page.getByLabel("ID do app Meta", { exact: true }).fill(account + "1");
  await page.getByLabel("ID da conta profissional", { exact: true }).fill(account);
  await page.getByLabel("Versão da Graph API", { exact: true }).fill("v26.0");
  await page.getByLabel("App Secret", { exact: true }).fill("e2e-app-secret");
  await page.getByLabel("Access Token", { exact: true }).fill(`e2e-account-${account}`);
  await page.getByRole("button", { name: "Salvar conexão Instagram" }).click();
  await expect(page.getByTestId("instagram-connection")).toBeVisible();
  await page.getByRole("button", { name: "Testar conexão Instagram" }).click();
  await expect(page.getByText("Token verificado", { exact: true })).toBeVisible();
}
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
export async function sendInstagramComment(email: string, commentId: string, text: string, mediaId = "80001") {
  const c = connectionFor(email);
  const body = JSON.stringify({ object: "instagram", entry: [{ id: c.accountId, time: Math.floor(Date.now() / 1000), changes: [{ field: "comments", value: { id: commentId, from: { id: "90002", username: "cliente_comentario" }, text, media: { id: mediaId, media_product_type: "REELS" } } }] }] });
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
