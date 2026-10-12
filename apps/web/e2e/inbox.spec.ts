import { test, expect } from "@playwright/test";
import { addMember, clearRateLimits, simulateInboundSql, psql } from "./support/local-db";
import { newEmail, signUp, signUpWithOrg } from "./support/auth";
import { gotoReady, reloadReady, settled } from "./support/nav";

test.setTimeout(90_000);
test.use({ actionTimeout: 30_000 });

test("inbox UI: vazio e atendimento com resposta, nota, validação e fechamento", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Inbox UI");
  await gotoReady(page, "/inbox");
  await expect(page.getByText("Nenhuma conversa ainda")).toBeVisible();
  await expect(page.getByText("Conecte um canal em Configurações → Canais")).toBeVisible();
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text: "Oi" });
  await reloadReady(page);
  const list = page.getByRole("region", { name: "Lista de conversas" });
  await expect(list.getByLabel("Conversa não lida")).toBeVisible();
  await list.getByRole("button", { name: /Carla/ }).click();
  const conversation = page.getByRole("region", { name: "Conversa", exact: true });
  await settled(conversation);
  await expect(conversation.getByText("Simulador", { exact: true })).toBeVisible();
  await page.getByLabel("Escreva sua mensagem").fill("   ");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByText("Escreva uma mensagem.")).toBeVisible();
  await page.getByLabel("Escreva sua mensagem").fill("a".repeat(4097));
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByText("A mensagem deve ter no máximo 4096 caracteres.")).toBeVisible();
  await page.getByLabel("Escreva sua mensagem").fill("Olá, Carla!");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(conversation.getByText("Entregue", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novas mensagens ↓", exact: true })).toHaveCount(0);
  await expect(list.getByText("Você: Olá, Carla!")).toBeVisible();
  await page.getByRole("button", { name: "Nota interna", exact: true }).click();
  await page.getByLabel("Escreva sua mensagem").fill("cliente VIP");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(conversation.getByText("cliente VIP")).toBeVisible();
  await expect(list.getByText("Você: Olá, Carla!")).toBeVisible();
  await page.getByRole("button", { name: "Assumir", exact: true }).click();
  await expect(conversation.getByText("Ana Souza assumiu a conversa")).toBeVisible();
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(conversation.getByText("Fechada", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Escreva sua mensagem")).toBeDisabled();
  await expect(page.getByText("Reabra a conversa para responder.")).toBeVisible();
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text: "Voltei" });
  await settled(conversation);
  await reloadReady(page);
  await expect(conversation.getByText("Aberta", { exact: true })).toBeVisible();
  await expect(conversation.getByText("Sem responsável", { exact: true })).toBeVisible();
  await expect(list.getByLabel("Conversa não lida")).toHaveCount(0);
  await settled(conversation);
  await settled(list);
  await page.screenshot({ path: "../../.superpowers/sdd/2026-10-10-fase-4-inbox/inbox-desktop.png", fullPage: true });
});

test("inbox UI: celular abre conversa e volta à lista", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Inbox Mobile");
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text: "Oi" });
  await gotoReady(page, "/inbox");
  await page.getByRole("region", { name: "Lista de conversas" }).getByRole("button", { name: /Carla/ }).click();
  await expect(page.getByRole("region", { name: "Conversa", exact: true })).toBeVisible();
  await settled(page.getByRole("region", { name: "Conversa", exact: true }));
  await page.screenshot({ path: "../../.superpowers/sdd/2026-10-10-fase-4-inbox/inbox-mobile.png", fullPage: true });
  await expect(page.getByRole("region", { name: "Lista de conversas" })).toBeHidden();
  await page.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(page.getByRole("region", { name: "Lista de conversas" })).toBeVisible();
});

test("inbox UI: transfere para membro com nota e viewer somente lê", async ({ page, browser }) => {
  const ownerEmail = newEmail();
  await signUpWithOrg(page, ownerEmail, "Org Inbox Members");
  const agentPage = await browser.newPage();
  const agentEmail = newEmail();
  await signUp(agentPage, agentEmail, "Bruno Lima");
  addMember(ownerEmail, agentEmail, "agent");
  const viewerPage = await browser.newPage();
  const viewerEmail = newEmail();
  await signUp(viewerPage, viewerEmail, "Luiza");
  addMember(ownerEmail, viewerEmail, "viewer");
  simulateInboundSql(ownerEmail, { name: "Carla", phone: "5511988887777", text: "Oi" });
  await gotoReady(page, "/inbox");
  await page.getByRole("region", { name: "Lista de conversas" }).getByRole("button", { name: /Carla/ }).click();
  await page.getByRole("button", { name: "Transferir", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Responsável").selectOption({ label: "Bruno Lima" });
  await dialog.getByLabel("Nota (opcional)").fill("Retornar amanhã");
  await dialog.getByRole("button", { name: "Transferir", exact: true }).click();
  const conversation = page.getByRole("region", { name: "Conversa", exact: true });
  await expect(conversation.getByText("Ana Souza transferiu para Bruno Lima")).toBeVisible();
  await expect(conversation.getByText("Retornar amanhã")).toBeVisible();
  await settled(conversation);
  await gotoReady(viewerPage, page.url());
  await expect(viewerPage.getByRole("region", { name: "Conversa", exact: true }).getByText("Oi", { exact: true })).toBeVisible();
  await expect(viewerPage.getByLabel("Escreva sua mensagem")).toHaveCount(0);
  await expect(viewerPage.getByRole("button", { name: "Transferir", exact: true })).toHaveCount(0);
  await expect(viewerPage.getByRole("button", { name: "Fechar", exact: true })).toHaveCount(0);
  await agentPage.close();
  await viewerPage.close();
});

test.beforeEach(() => clearRateLimits());

test("inbox API: 401 sem sessão", async ({ request }) => {
  const res = await request.get("/api/inbox");
  expect(res.status()).toBe(401);
});

test("inbox API: lista, contadores e aba fechadas", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Inbox API");
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text: "Oi, quero o preço" });
  simulateInboundSql(email, { name: "Bruno", phone: "5511977776666", text: "Olá $$ 'aspas'" });

  const res = await page.request.get("/api/inbox");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = await res.json();
  expect(body.items).toHaveLength(2);
  expect(body.counts["nao-atribuidas"]).toBe(2);
  expect(body.counts.todas).toBe(2);
  expect(body.counts.minhas).toBe(0);
  expect(body.counts.fechadas).toBe(0);
  expect(body.items[0].preview.text).toBe("Olá $$ 'aspas'");
  expect(body.items[0].channel.type).toBe("simulator");

  const closed = await (await page.request.get("/api/inbox?aba=fechadas")).json();
  expect(closed.items).toHaveLength(0);

  const search = await (await page.request.get("/api/inbox?q=carla")).json();
  expect(search.items).toHaveLength(1);
  const byPhone = await (await page.request.get("/api/inbox?q=" + encodeURIComponent("(11) 97777-6666"))).json();
  expect(byPhone.items).toHaveLength(1);
  const byText = await (await page.request.get("/api/inbox?q=pre%C3%A7o")).json();
  expect(byText.items).toHaveLength(1);

  const id = body.items[1].id;
  const detail = await page.request.get(`/api/inbox/${id}`);
  expect(detail.status()).toBe(200);
  const d = await detail.json();
  expect(d.messages).toHaveLength(1);
  expect(d.hasMore).toBe(false);
  const missing = await page.request.get("/api/inbox/00000000-0000-4000-8000-000000000000");
  expect(missing.status()).toBe(404);
});

test("inbox UI: histórico pagina mensagens com o mesmo horário sem perder nenhuma", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Histórico Inbox");
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text: "Primeira mensagem" });
  const body = await (await page.request.get("/api/inbox")).json();
  const id = body.items[0].id as string;
  psql(`insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status, created_at)
    select organization_id, id, channel_id, 'inbound', 'contact', 'Histórico ' || n, 'delivered', now()
    from public.conversations cross join generate_series(1, 55) n where id = '${id}'`);
  await gotoReady(page, `/inbox?c=${id}`);
  const history = page.getByRole("log", { name: "Histórico de mensagens" });
  await expect(history.getByTestId("message-bubble")).toHaveCount(50);
  await page.getByRole("button", { name: "Ver anteriores", exact: true }).click();
  await expect(history.getByTestId("message-bubble")).toHaveCount(56);
  await expect(page.getByRole("button", { name: "Ver anteriores", exact: true })).toHaveCount(0);
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text: "Mensagem 57" });
  await expect(history.getByTestId("message-bubble")).toHaveCount(57);
  await expect(history.getByText("Primeira mensagem", { exact: true })).toBeAttached();
});
