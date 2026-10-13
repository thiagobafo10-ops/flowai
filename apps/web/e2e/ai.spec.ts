import { test, expect, type Page } from "@playwright/test";
import { newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";
import { clearRateLimits, simulateInboundSql } from "./support/local-db";
import { aiJobStates, aiMessageCount, chatCompletionCount, drainAiJobs } from "./support/ai";

const AI_TEXT = "Frete grátis para compras acima de R$ 200.";
const HANDOFF_TEXT = "Vou te encaminhar para um atendente, só um instante.";

test.beforeEach(() => clearRateLimits());

async function createDocument(page: Page) {
  await gotoReady(page, "/conhecimento");
  await page.getByRole("button", { name: "Novo documento" }).first().click();
  await page.getByLabel("Título", { exact: true }).fill("Frete");
  await page.getByLabel("Conteúdo", { exact: true }).fill(AI_TEXT);
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("row", { name: /Frete/ })).toContainText("Processando");
}
async function indexDocument(page: Page, email: string) {
  await drainAiJobs(email);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("row", { name: /Frete/ })).toContainText("Pronto", { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("row", { name: /Frete/ })).toContainText("1 trecho");
}
async function enableAgent(page: Page) {
  await gotoReady(page, "/ia");
  await page.getByRole("switch", { name: "Agente ativo" }).check();
  await page.getByRole("switch", { name: "Responder automaticamente" }).check();
  await page.getByRole("button", { name: "Salvar", exact: true }).first().click();
  await expect(page.getByText("Agente salvo.").first()).toBeVisible();
}
/** Simulates an inbound message and opens its conversation in the Inbox. */
async function inbound(page: Page, email: string, text: string): Promise<void> {
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text });
  await gotoReady(page, "/inbox");
  await page.getByText(text, { exact: true }).first().click();
  await expect(page.getByTestId("message-bubble").filter({ hasText: text })).toBeVisible();
}
async function readyKnowledge(page: Page, email: string) {
  await signUpWithOrg(page, email, "IA E2E");
  await createDocument(page);
  await indexDocument(page, email);
}

test("IA: documento é indexado e fica pronto com um trecho", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "IA E2E");
  await createDocument(page);
  await indexDocument(page, email);
});

test("IA: responde com base no documento e conta o uso", async ({ page }) => {
  const email = newEmail();
  await readyKnowledge(page, email);
  await enableAgent(page);
  const callsBefore = await chatCompletionCount();
  await inbound(page, email, "Qual o valor do frete grátis?");
  await drainAiJobs(email);
  const reply = page.getByTestId("message-bubble").filter({ has: page.getByTestId("ai-badge") });
  await expect(reply).toContainText("R$ 200", { timeout: 20_000 });
  await gotoReady(page, "/ia");
  await expect(page.getByText("1 de 300 respostas")).toBeVisible();
  expect(await chatCompletionCount()).toBeGreaterThan(callsBefore);
});

test("IA: sem informação na base transfere para um atendente", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "IA E2E");
  await enableAgent(page);
  await inbound(page, email, "Vocês aceitam bitcoin?");
  await drainAiJobs(email);
  await expect(page.getByText("Transferida pela IA: IA sem informação na base de conhecimento")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("message-bubble").filter({ hasText: HANDOFF_TEXT })).toBeVisible();
});

test("IA: devolver para IA remove o aviso e registra a mensagem de sistema", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "IA E2E");
  await enableAgent(page);
  await inbound(page, email, "Vocês aceitam bitcoin?");
  await drainAiJobs(email);
  const banner = page.getByText("Transferida pela IA: IA sem informação na base de conhecimento");
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Devolver para IA" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByText(/devolveu a conversa para a IA/)).toBeVisible();
});

test("IA: área de teste responde com trechos e conta o uso", async ({ page }) => {
  await readyKnowledge(page, newEmail());
  await gotoReady(page, "/ia");
  await page.getByLabel("Mensagem do contato").fill("Qual o valor do frete grátis?");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  const playground = page.getByRole("region", { name: "Área de teste" });
  await expect(playground).toContainText("R$ 200", { timeout: 20_000 });
  await playground.getByText("Detalhes da resposta").click();
  await expect(playground.getByText("Trechos usados")).toBeVisible();
  await expect(playground.getByRole("listitem").filter({ hasText: /^Frete \(/ })).toBeVisible();
  await expect(page.getByText("1 de 30 testes")).toBeVisible();
});

test("IA: quando o atendente responde antes, a IA não envia nada", async ({ page }) => {
  const email = newEmail();
  await readyKnowledge(page, email);
  await enableAgent(page);
  await inbound(page, email, "Qual o valor do frete grátis?");
  await page.getByLabel("Escreva sua mensagem").fill("Já te respondo por aqui");
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByTestId("message-bubble").filter({ hasText: "Já te respondo por aqui" })).toBeVisible();
  // The human reply must cancel the pending reply task; the worker then evaluates and skips it.
  await expect.poll(() => aiJobStates(email).filter((state) => state.startsWith("reply:")), { timeout: 10_000 }).toEqual(["reply:cancelled"]);
  const callsBefore = await chatCompletionCount();
  await drainAiJobs(email);
  expect(aiJobStates(email).filter((state) => state.startsWith("reply:"))).toEqual(["reply:cancelled"]);
  expect(await chatCompletionCount()).toBe(callsBefore);
  expect(aiMessageCount(email)).toBe(0);
  await expect(page.getByTestId("ai-badge")).toHaveCount(0);
});
