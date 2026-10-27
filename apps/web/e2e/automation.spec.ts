import { createHmac } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";
import { clearRateLimits, psql, simulateInboundSql } from "./support/local-db";
import { AUTOMATION_TEST_URL, activate, createDelayFlow, createTemplate, drainAutomationRuns, orgFor, selectNode } from "./support/automation";
import { confirmWebhook, connectionFor, connectInstagram, sendInstagramComment } from "./support/instagram";

test.setTimeout(120_000);
test.beforeEach(() => clearRateLimits());
async function qualify(page: Page, email: string) {
  await signUpWithOrg(page, email, "Automação E2E");
  const org = orgFor(email);
  psql(`insert into public.tags(organization_id,name,color) values ('${org}','Inicial','#888888'),('${org}','Qualificado','#22aa44')`);
  const id = await createTemplate(page, "Qualificar lead com botões");
  await selectNode(page, "tag");
  await page.getByLabel("Etiqueta", { exact: true }).selectOption({ label: "Qualificado" });
  await selectNode(page, "move_stage");
  await page.getByLabel("Etapa do funil").selectOption({ label: "Interessado" });
  await activate(page);
  return { id, org };
}
async function inbound(page: Page, email: string, text = "Quero um orçamento") {
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text });
  await drainAutomationRuns(email);
  await gotoReady(page, "/inbox");
  await page.getByRole("region", { name: "Lista de conversas" }).getByRole("button", { name: /Carla/ }).click();
}

test("Automação: builder configura modelo, etiqueta e etapa e ativa", async ({ page }) => {
  const email = newEmail(); const { id, org } = await qualify(page, email);
  await page.getByRole("button", { name: "Fechar painel" }).click();
  const detail = await (await page.request.get(`/api/automacoes/${id}`)).json();
  const stage = detail.graph.nodes.find((node: { type: string }) => node.type === "move_stage");
  const card = page.locator(`.react-flow__node[data-id="${stage.id}"]`);
  const box = await card.boundingBox();
  if (!box) throw new Error("Stage node is not visible for dragging");
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 35, box.y + 28, { steps: 8 }); await page.mouse.up();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Automação salva.").first()).toBeVisible();
  const moved = await (await page.request.get(`/api/automacoes/${id}`)).json();
  expect(moved.graph.nodes.find((node: { id: string }) => node.id === stage.id).position).not.toEqual(stage.position);
  await page.getByRole("button", { name: "Fechar painel" }).click();
  await drainAutomationRuns(email);
  expect(psql(`select status from public.automations where organization_id='${org}'`)).toBe("active");
});

test("Automação: Simulador mostra opções, bloqueia IA e transfere com etiqueta e etapa", async ({ page }) => {
  const email = newEmail(); const { org } = await qualify(page, email);
  // Enable automatic AI to prove dispatch suppresses it while automation owns the conversation.
  psql(`update public.ai_agents set is_active=true,auto_reply=true where organization_id='${org}'`);
  await gotoReady(page, "/configuracoes/canais");
  await page.getByRole("button", { name: "Criar canal Simulador" }).click();
  const block = page.getByTestId("simulator-channel");
  await block.getByLabel("Nome", { exact: true }).fill("Carla");
  await block.getByLabel("Telefone").fill("(11) 98888-7777");
  await block.getByLabel("Mensagem").fill("Quero um orçamento");
  await block.getByRole("button", { name: "Simular mensagem recebida" }).click();
  await expect(page.getByText("Mensagem simulada.").first()).toBeVisible();
  await drainAutomationRuns(email);
  await gotoReady(page, "/inbox");
  await page.getByRole("region", { name: "Lista de conversas" }).getByRole("button", { name: /Carla/ }).click();
  const bubble = page.getByTestId("message-bubble").filter({ has: page.getByTestId("automation-badge") });
  await expect(bubble).toContainText("você quer receber um orçamento agora?");
  await expect(bubble.getByRole("button", { name: "Sim", exact: true })).toBeVisible();
  await expect(bubble.getByRole("button", { name: "Ainda não", exact: true })).toBeVisible();
  await expect(page.getByText("Em automação: Qualificar lead com botões")).toBeVisible();
  expect(Number(psql(`select count(*) from public.ai_jobs where organization_id='${org}' and kind='reply'`))).toBe(0);
  expect(Number(psql(`select count(*) from public.messages where organization_id='${org}' and sender_type='ai'`))).toBe(0);
  await bubble.getByRole("button", { name: "Sim", exact: true }).click();
  await drainAutomationRuns(email);
  const handoffText = "Automação transferiu para atendimento humano";
  await expect(page.getByTestId("handoff-banner")).toContainText(handoffText);
  await expect(page.getByTestId("system-message").filter({ hasText: handoffText })).toBeVisible();
  const panel = page.getByRole("region", { name: "Contato da conversa" });
  await expect(panel.getByRole("list", { name: "Tags do contato" }).getByText("Qualificado", { exact: true })).toBeVisible();
  await expect(panel.getByText("Etapa: Interessado", { exact: true })).toBeVisible();
  expect(psql(`select status from public.conversations where organization_id='${org}'`)).toBe("pending_human");
});

test("Automação: parar uma execução aguardando remove o aviso e registra o sistema", async ({ page }) => {
  const email = newEmail(); const { org } = await qualify(page, email);
  await inbound(page, email);
  expect(psql(`select status from public.automation_runs where organization_id='${org}'`)).toBe("waiting");
  await page.getByRole("button", { name: "Parar automação" }).click();
  await drainAutomationRuns(email);
  await expect(page.getByText("Em automação: Qualificar lead com botões")).toHaveCount(0);
  await expect(page.getByText("Automação interrompida por Ana Souza")).toBeVisible();
  expect(psql(`select status from public.automation_runs where organization_id='${org}'`)).toBe("cancelled");
});

test("Automação: espera de um minuto retoma quando resume_at vence", async ({ page }) => {
  const email = newEmail(); await signUpWithOrg(page, email, "Espera E2E");
  const org = orgFor(email); createDelayFlow(email);
  await inbound(page, email, "Aguardar");
  expect(psql(`select status||':'||waiting_for from public.automation_runs where organization_id='${org}'`)).toBe("waiting:delay");
  await expect(page.getByTestId("message-bubble").filter({ hasText: "Espera concluída" })).toHaveCount(0);
  psql(`update public.automation_runs set resume_at=now()-interval '1 second' where organization_id='${org}' and status='waiting'`);
  await drainAutomationRuns(email);
  await expect(page.getByTestId("message-bubble").filter({ hasText: "Espera concluída" })).toBeVisible();
  expect(psql(`select status from public.automation_runs where organization_id='${org}'`)).toBe("completed");
});

test("Automação: comentário assinado envia private reply com postback e segue após clique", async ({ page }) => {
  const email = newEmail(); await signUpWithOrg(page, email, "Comentário E2E");
  await connectInstagram(page); await confirmWebhook(email);
  const org = orgFor(email); await createTemplate(page, "Responder comentário com link");
  await selectNode(page, "message", 1);
  await page.getByLabel("Link do botão 1").fill("https://flowai.example/guia");
  await activate(page);
  const comment = String(Date.now()); await sendInstagramComment(email, comment, "QUERO");
  await drainAutomationRuns(email, true);
  const calls = await (await fetch(`${AUTOMATION_TEST_URL}/__test__/graph-calls`)).json();
  const first = calls.find((c: { body: { recipient: { comment_id?: string } } }) => c.body.recipient.comment_id === comment);
  expect(first).toBeTruthy();
  const button = first.body.message.attachment.payload.buttons[0];
  expect(button).toMatchObject({ type: "postback", title: "Quero" });
  expect(button.payload).toMatch(/^fa1\./);
  const c = connectionFor(email);
  const body = JSON.stringify({ object: "instagram", entry: [{ id: c.accountId, messaging: [{ sender: { id: "90002" }, recipient: { id: c.accountId }, timestamp: Date.now(), postback: { mid: `click-${comment}`, title: "Quero", payload: button.payload } }] }] });
  const signature = createHmac("sha256", "e2e-app-secret").update(body).digest("hex");
  const response = await fetch(`${AUTOMATION_TEST_URL}/functions/v1/meta-webhook/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${signature}` }, body });
  expect(response.status).toBe(200); await drainAutomationRuns(email, true);
  const after = await (await fetch(`${AUTOMATION_TEST_URL}/__test__/graph-calls`)).json();
  expect(after.filter((call: { accountId: string }) => call.accountId === c.accountId)).toHaveLength(2);
  // URL buttons go out as tracked links (/r/<code>) that store the original destination.
  expect(after.at(-1).body).toMatchObject({ recipient: { id: "90002" }, message: { attachment: { payload: { text: expect.stringContaining("Aqui está"), buttons: [{ type: "web_url", url: expect.stringMatching(/^https:\/\/flowai-web-rust\.vercel\.app\/r\/[a-z0-9]{12}$/), title: "Abrir link" }] } } } });
  const code = after.at(-1).body.message.attachment.payload.buttons[0].url.slice(-12);
  expect(psql(`select url from public.tracked_links where code='${code}' and organization_id='${org}'`)).toBe("https://flowai.example/guia");
  expect(psql(`select status from public.automation_runs where organization_id='${org}'`)).toBe("completed");
});

test("Automação: aba Execuções expande execução concluída com passos", async ({ page }) => {
  const email = newEmail(); const { id, org } = await qualify(page, email);
  await inbound(page, email); await page.getByRole("button", { name: "Sim", exact: true }).click();
  await drainAutomationRuns(email);
  expect(psql(`select status from public.automation_runs where organization_id='${org}'`)).toBe("completed");
  await gotoReady(page, `/automacoes/${id}`);
  await page.getByRole("tab", { name: "Execuções", exact: true }).click();
  const run = page.getByTestId("automation-run");
  await expect(run).toContainText("Concluída"); await expect(run).toContainText("Carla");
  await run.getByRole("button").first().click();
  await expect(page.getByTestId("automation-run-step").filter({ hasText: "Adicionar etiqueta" })).toBeVisible();
  await expect(page.getByTestId("automation-run-step").filter({ hasText: "Transferir para humano" })).toBeVisible();
});
