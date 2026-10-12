import { test, expect, type Page } from "@playwright/test";
import { newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";
import { clearRateLimits, psql } from "./support/local-db";
import { confirmWebhook, connectionFor, runInstagramWorker, sendInstagramComment, sendInstagramEvent } from "./support/instagram";

test.beforeEach(() => clearRateLimits());
async function connect(page: Page, email: string) {
  await signUpWithOrg(page, email, "Instagram E2E");
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
  await page.getByLabel("Palavra-chave", { exact: true }).fill("preço");
  await page.getByLabel("Resposta no Direct", { exact: true }).fill("Aqui está seu guia");
  await page.getByRole("button", { name: "Salvar regra" }).click();
  const rule = page.getByTestId("instagram-rule"); await expect(rule).toContainText("Desativada");
  await expect(page.getByText(/mais antiga ativa/)).toBeVisible();
  await rule.getByRole("button", { name: "Ativar regra" }).click(); await expect(rule.getByText("Ativa", { exact: true })).toBeVisible();
  const id = String(Date.now()); await sendInstagramComment(email, id, "QUERO PRECO!"); await runInstagramWorker();
  await sendInstagramComment(email, id, "QUERO PRECO!"); await runInstagramWorker();
  const c = connectionFor(email);
  expect(Number(psql(`select count(*) from public.messages where channel_id='${c.channelId}' and content='Aqui está seu guia' and sender_type='automation'`))).toBe(1);
});
test("Instagram: desativar regra antes do worker descarta resposta antiga", async ({ page }) => {
  const email = newEmail(); await connect(page, email); await confirmWebhook(email); await page.reload();
  await page.getByLabel("Palavra-chave", { exact: true }).fill("guia"); await page.getByLabel("Resposta no Direct", { exact: true }).fill("Não enviar depois de desativar");
  await page.getByRole("button", { name: "Salvar regra" }).click(); const rule=page.getByTestId("instagram-rule");
  await rule.getByRole("button", { name: "Ativar regra" }).click(); await expect(rule.getByText("Ativa", { exact: true })).toBeVisible();
  await sendInstagramComment(email, String(Date.now()), "guia"); await rule.getByRole("button", { name: "Desativar regra" }).click(); await expect(rule).toContainText("Desativada");
  await runInstagramWorker(); const c=connectionFor(email);
  expect(Number(psql(`select count(*) from public.messages where channel_id='${c.channelId}' and sender_type='automation'`))).toBe(0);
});
test("Instagram: regra de post próprio pode ser desligada mesmo com token expirado", async ({ page }) => {
  const email = newEmail(); await connect(page, email); await confirmWebhook(email); await page.reload();
  await page.getByLabel("Palavra-chave", { exact: true }).fill("post");
  await page.getByLabel("Resposta no Direct", { exact: true }).fill("Resposta de post específico");
  await page.getByLabel("Aplicar regra em", { exact: true }).selectOption("post");
  await page.getByLabel("ID do post ou Reel", { exact: true }).fill("80001");
  await page.getByRole("button", { name: "Salvar regra" }).click();
  const rule = page.getByTestId("instagram-rule"); await expect(rule).toContainText("Post/Reel 80001");
  await rule.getByRole("button", { name: "Ativar regra" }).click(); await expect(rule.getByText("Ativa", { exact: true })).toBeVisible();
  const c = connectionFor(email);
  psql(`select vault.update_secret(access_token_secret_id,'expired-token') from public.channels where id='${c.channelId}'; select public.set_meta_connection_verification('${c.id}','token',false,'invalid_token',1)`);
  await page.reload();
  await expect(page.getByTestId("instagram-connection").getByRole("alert")).toHaveText("O token do Instagram é inválido ou expirou. Atualize as credenciais.");
  await rule.getByRole("button", { name: "Desativar regra" }).click();
  await expect(rule.getByText("Desativada", { exact: true })).toBeVisible();
});
