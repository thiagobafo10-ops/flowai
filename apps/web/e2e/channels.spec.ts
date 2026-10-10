import { test, expect } from "@playwright/test";
import { addMember, clearRateLimits } from "./support/local-db";
import { newEmail, signUp, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";

test.beforeEach(() => clearRateLimits());

test("canais: criar simulador, simular mensagem, desativar", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Canais");
  await gotoReady(page, "/configuracoes/canais");
  await expect(page.getByRole("link", { name: "Canais" })).toBeVisible();
  await expect(page.getByText("Disponível em breve")).toBeVisible();

  await page.getByRole("button", { name: "Criar canal Simulador" }).click();
  const block = page.getByTestId("simulator-channel");
  await expect(block.getByText("Ativo", { exact: true })).toBeVisible();

  await block.getByLabel("Nome").fill("Carla");
  await block.getByLabel("Telefone").fill("(11) 98888-7777");
  await block.getByLabel("Mensagem").fill("Oi, quero saber o preço");
  await block.getByRole("button", { name: "Simular mensagem recebida" }).click();
  await expect(page.getByText("Mensagem simulada.").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir no Inbox" }).first()).toBeVisible();

  await gotoReady(page, "/contatos");
  const row = page.getByRole("row", { name: /Carla/ });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Simulador");

  await gotoReady(page, "/configuracoes/canais");
  await page.getByRole("button", { name: "Desativar" }).click();
  await expect(block.getByText("Desativado", { exact: true })).toBeVisible();
  await block.getByLabel("Telefone").fill("(11) 98888-7777");
  await block.getByLabel("Mensagem").fill("Outra mensagem");
  await block.getByRole("button", { name: "Simular mensagem recebida" }).click();
  await expect(page.getByText("O canal Simulador está desativado.").first()).toBeVisible();

  await page.getByRole("button", { name: "Reativar" }).click();
  await expect(block.getByText("Ativo", { exact: true })).toBeVisible();
});

test("canais: agente não vê a aba nem acessa a página", async ({ page, browser }) => {
  const ownerEmail = newEmail();
  const agentEmail = newEmail();
  await signUpWithOrg(page, ownerEmail, "Org Canais Agente");
  const ctx = await browser.newContext();
  const agent = await ctx.newPage();
  await signUp(agent, agentEmail);
  addMember(ownerEmail, agentEmail, "agent");
  await gotoReady(agent, "/configuracoes/tags");
  await expect(agent.getByRole("link", { name: "Tags" })).toBeVisible();
  await expect(agent.getByRole("link", { name: "Canais" })).toHaveCount(0);
  await gotoReady(agent, "/configuracoes/canais");
  await expect(agent.getByText("Você não tem permissão para esta ação.")).toBeVisible();
  await expect(agent.getByRole("button", { name: "Criar canal Simulador" })).toHaveCount(0);
  await ctx.close();
});
