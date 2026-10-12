import { test, expect } from "@playwright/test";
import { newEmail, signUpWithOrg } from "./support/auth";
import { clearRateLimits, simulateInboundSql, contactIdByName, psql } from "./support/local-db";
import { gotoReady, settled } from "./support/nav";

test.setTimeout(90_000);
test.use({ actionTimeout: 30_000 });

test.beforeEach(() => clearRateLimits());

test("ficha lista conversas e confirma exclusão das mensagens", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Ficha Inbox");
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text: "Oi, quero saber o preço" });
  const id = contactIdByName(email, "Carla");
  await gotoReady(page, `/contatos/${id}`);
  const card = page.getByRole("region", { name: "Conversas", exact: true });
  await expect(card).toContainText("Simulador");
  await expect(card).toContainText("Oi, quero saber o preço");
  await expect(page.getByText("Nenhuma conversa ainda.", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("link")).toHaveAttribute("href", /\/inbox\?c=/);
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("As tags, os campos, os deals, as conversas e as mensagens deste contato também serão excluídos.");
});

test("painel mostra contato, IA, tags e permite criar e mover deal", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Painel Inbox");
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text: "Oi" });
  simulateInboundSql(email, { name: "Bruno Painel", phone: "5511977774444", text: "Olá" });
  const id = contactIdByName(email, "Carla");
  const conversationId = psql(`select id from public.conversations where contact_id = '${id}' limit 1`);
  await gotoReady(page, `/inbox?c=${conversationId}`);
  const panel = page.getByRole("region", { name: "Contato da conversa", exact: true });
  await expect(panel).toContainText("Carla");
  await expect(panel).toContainText("(11) 98888-7777");
  await expect(panel.getByRole("link", { name: "Ver ficha" })).toHaveAttribute("href", `/contatos/${id}`);
  await expect(panel.getByText("Aguardando IA").first()).toBeVisible();
  await panel.getByRole("button", { name: "Adicionar tag" }).click();
  await panel.getByLabel("Nova tag").fill("Quente");
  await panel.getByRole("button", { name: "Criar tag", exact: true }).click();
  await expect(panel.getByRole("list", { name: "Tags do contato" })).toContainText("Quente");
  await settled(panel.getByRole("region", { name: "Tags", exact: true }));
  // O painel lateral monta uma segunda ficha do mesmo contato sem evento de leitura.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole("button", { name: "Contato", exact: true }).click();
  await expect(panel.getByRole("list", { name: "Tags do contato" })).toContainText("Quente");
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Ocultar contato", exact: true }).click();
  await page.getByRole("button", { name: "Mostrar contato", exact: true }).click();
  await expect(panel.getByRole("list", { name: "Tags do contato" })).toContainText("Quente");
  const list = page.getByRole("region", { name: "Lista de conversas", exact: true });
  await list.getByRole("button", { name: /Bruno Painel/ }).click();
  await expect(panel).toContainText("Bruno Painel");
  await list.getByRole("button", { name: /Carla/ }).click();
  await expect(panel.getByRole("list", { name: "Tags do contato" })).toContainText("Quente");
  // Outra pessoa edita o e-mail enquanto o painel ainda tem o valor antigo.
  psql(`update public.contacts set email = 'carla.nova@example.com' where id = '${id}'`);
  await panel.getByLabel("Lead score", { exact: true }).fill("73");
  await panel.getByRole("button", { name: "Salvar lead score", exact: true }).click();
  await expect.poll(() => psql(`select lead_score from public.contacts where id = '${id}'`)).toBe("73");
  expect(psql(`select email from public.contacts where id = '${id}'`)).toBe("carla.nova@example.com");
  await panel.getByRole("button", { name: "Criar deal", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo deal" });
  await expect(dialog).toContainText("Carla");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await panel.getByLabel("Mover etapa").selectOption({ label: "Interessado" });
  await expect(panel).toContainText("Etapa: Interessado");
  await gotoReady(page, `/contatos/${id}`);
  await expect(page.getByRole("list", { name: "Tags do contato" })).toContainText("Quente");
});

test("lead score acompanha atualização remota sem substituir edição em andamento", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Score Inbox");
  const inbound = { name: "Carla Score", phone: "5511988885555", text: "Oi" };
  simulateInboundSql(email, inbound);
  const id = contactIdByName(email, "Carla Score");
  const conversationId = psql(`select id from public.conversations where contact_id = '${id}' limit 1`);
  await gotoReady(page, `/inbox?c=${conversationId}`);
  const panel = page.getByRole("region", { name: "Contato da conversa", exact: true });
  const score = panel.getByLabel("Lead score", { exact: true });
  await expect(score).toHaveValue("0");
  // O evento de mensagem invalida o contato no cache através do Realtime.
  psql(`update public.contacts set lead_score = 73 where id = '${id}'`);
  simulateInboundSql(email, { ...inbound, text: "Atualização de score" });
  await expect(score).toHaveValue("73");
  await score.fill("62");
  psql(`update public.contacts set lead_score = 91, email = 'score.remote@example.com' where id = '${id}'`);
  simulateInboundSql(email, { ...inbound, text: "Outra atualização de score" });
  await expect(panel.getByText("score.remote@example.com", { exact: true })).toBeVisible();
  await expect(score).toHaveValue("62");
});


test("conversa de outra organização não seleciona nem revela dados", async ({ page, context }) => {
  const firstEmail = newEmail();
  await signUpWithOrg(page, firstEmail, "Org Privada Inbox");
  simulateInboundSql(firstEmail, { name: "Contato privado", phone: "5511988886666", text: "Mensagem privada" });
  const contactId = contactIdByName(firstEmail, "Contato privado");
  const conversationId = psql(`select id from public.conversations where contact_id = '${contactId}' limit 1`);
  await context.clearCookies();
  await signUpWithOrg(page, newEmail(), "Org Segura Inbox");
  await gotoReady(page, `/inbox?c=${conversationId}`);
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  await expect(page.getByText("Contato privado", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Mensagem privada", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Contato da conversa", exact: true })).toHaveCount(0);
  const response = await page.request.get(`/api/inbox/contact/${contactId}?c=${conversationId}`);
  expect(response.status()).toBe(404);
});
