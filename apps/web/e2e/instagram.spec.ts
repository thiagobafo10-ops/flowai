import { test, expect, type Page } from "@playwright/test";
import { newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";
import { clearRateLimits, psql } from "./support/local-db";
import { confirmWebhook, connectionFor, runInstagramWorker, sendInstagramComment, sendInstagramEvent, connectInstagram, INSTAGRAM_TEST_URL } from "./support/instagram";

import { authorComment, drainAutomationRuns, selectNode } from "./support/automation";

test.beforeEach(() => clearRateLimits());
async function connect(page: Page, email: string) {
  await signUpWithOrg(page, email, "Instagram E2E");
  await connectInstagram(page);
}
test("Instagram: conexão separa token e webhook e apaga segredos do formulário", async ({ page }) => {
  const email = newEmail(); await connect(page, email);
  await expect(page.getByText("Webhook pendente", { exact: true })).toBeVisible();
  await expect(page.getByLabel("App Secret", { exact: true })).toHaveCount(0);
  await confirmWebhook(email); await page.reload();
  await expect(page.getByText("Webhook confirmado", { exact: true })).toBeVisible();
  await expect(page.getByTestId("instagram-connection").getByText("Ativo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mostrar verify token" }).click();
  await expect(page.getByLabel("Verify token", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ocultar verify token" }).click();
  await expect(page.getByLabel("Verify token", { exact: true })).toHaveCount(0);
  if (process.env.FLOWAI_SCREENSHOT_DIR) {
    const output = process.env.FLOWAI_SCREENSHOT_DIR.replace(/\\/g, "/");
    await page.screenshot({ path: `${output}/flowai-instagram-desktop-2026-10-12.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${output}/flowai-instagram-mobile-2026-10-12.png`, fullPage: true });
  }
});
test("Instagram: webhook assinado chega ao Inbox com story e permite responder", async ({ page }) => {
  const email = newEmail(); await connect(page, email); await confirmWebhook(email);
  await sendInstagramEvent(email, { mid: "story-" + Date.now(), text: "Quero o produto", reply_to: { story: { id: "80002", url: "https://example.test/story" } } });
  await gotoReady(page, "/inbox"); await page.getByText("Quero o produto", { exact: true }).first().click();
  await expect(page.getByText("Resposta a story", { exact: true })).toBeVisible();
  await page.getByLabel("Escreva sua mensagem").fill("Olá, posso ajudar");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByTestId("message-bubble").filter({ hasText: "Olá, posso ajudar" })).toContainText("Enviada");
  const c = connectionFor(email);
  expect(Number(psql(`select count(*) from public.contacts where instagram_id='90001' and organization_id=(select organization_id from public.channels where id='${c.channelId}')`))).toBe(1);
  await runInstagramWorker();
  expect(psql(`select name from public.contacts where instagram_id='90001' and organization_id=(select organization_id from public.channels where id='${c.channelId}')`)).toBe("Cliente Instagram");
});
test("Instagram: fora da janela de 24h o composer só permite nota interna", async ({ page }) => {
  const email = newEmail(); await connect(page, email); await confirmWebhook(email);
  await sendInstagramEvent(email, { mid: "old-" + Date.now(), text: "Mensagem de ontem" }, "90003", Date.now() - 25 * 60 * 60 * 1000);
  await gotoReady(page, "/inbox"); await page.getByText("Mensagem de ontem", { exact: true }).first().click();
  await expect(page.getByText("A janela de 24 horas do Instagram expirou. Aguarde uma nova mensagem do contato para responder.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Responder" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Nota interna" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Escreva sua mensagem").fill("Cliente pediu retorno amanhã");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByTestId("message-bubble").filter({ hasText: "Cliente pediu retorno amanhã" })).toContainText("Nota interna");
  const c = connectionFor(email);
  expect(Number(psql(`select count(*) from public.instagram_send_intents where channel_id='${c.channelId}'`))).toBe(0);
});
test("Instagram: palavra-chave acentuada gera uma resposta privada única", async ({ page }) => {
  const email = newEmail(); await connect(page, email); await confirmWebhook(email); await page.reload();
  await expect(page.getByText("As regras de comentário agora são automações.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Gerenciar em Automações" })).toHaveAttribute("href", "/automacoes");
  await authorComment(page, "preço", "Aqui está seu guia");
  const id = String(Date.now()); await sendInstagramComment(email, id, "QUERO PRECO!"); await drainAutomationRuns(email, true);
  await sendInstagramComment(email, id, "QUERO PRECO!"); await drainAutomationRuns(email, true);
  const c = connectionFor(email);
  expect(Number(psql(`select count(*) from public.messages where channel_id='${c.channelId}' and content='Aqui está seu guia' and sender_type='automation'`))).toBe(1);
  const calls = await (await fetch(`${INSTAGRAM_TEST_URL}/__test__/graph-calls`)).json();
  expect(calls.filter((call: { body: { recipient: { comment_id?: string } } }) => call.body.recipient.comment_id === id)).toHaveLength(1);
});
test("Instagram: pausar automação antes do worker descarta resposta antiga", async ({ page }) => {
  const email = newEmail(); await connect(page, email); await confirmWebhook(email);
  await authorComment(page, "guia", "Não enviar depois de pausar");
  await sendInstagramComment(email, String(Date.now()), "guia");
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await expect(page.locator("header").getByText("Pausada", { exact: true })).toBeVisible();
  await drainAutomationRuns(email, true); const c = connectionFor(email);
  expect(Number(psql(`select count(*) from public.messages where channel_id='${c.channelId}' and sender_type='automation'`))).toBe(0);
});
test("Instagram: automação de post próprio pausa mesmo com token expirado", async ({ page }) => {
  const email = newEmail(); await connect(page, email); await confirmWebhook(email);
  const automation = await authorComment(page, "post", "Resposta de post específico");
  const c = connectionFor(email);
  // Ownership is checked by the worker before the first private reply.
  const foreign = String(Date.now());
  await sendInstagramComment(email, foreign, "post", "80099");
  await drainAutomationRuns(email, true);
  expect(psql(`select last_error from public.instagram_events where channel_id='${c.channelId}' and external_id='${foreign}'`)).toBe("media_not_owned");
  expect(Number(psql(`select count(*) from public.instagram_send_intents where channel_id='${c.channelId}' and state='sent'`))).toBe(0);
  await selectNode(page, "trigger");
  await page.getByLabel("ID da publicação (opcional)").fill("80001");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Automação salva.").first()).toBeVisible();
  const owned = String(Date.now());
  await sendInstagramComment(email, owned, "post"); await drainAutomationRuns(email, true);
  expect(Number(psql(`select count(*) from public.instagram_send_intents where channel_id='${c.channelId}' and state='sent'`))).toBe(1);
  psql(`select vault.update_secret(access_token_secret_id,'expired-token') from public.channels where id='${c.channelId}'; select public.set_meta_connection_verification('${c.id}','token',false,'invalid_token',1)`);
  await gotoReady(page, "/configuracoes/canais");
  await expect(page.getByTestId("instagram-connection").getByRole("alert")).toHaveText("O token do Instagram é inválido ou expirou. Atualize as credenciais.");
  await gotoReady(page, `/automacoes/${automation}`);
  await page.getByRole("button", { name: "Pausar", exact: true }).click();
  await expect(page.locator("header").getByText("Pausada", { exact: true })).toBeVisible();
});
