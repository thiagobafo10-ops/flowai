import { test, expect } from "@playwright/test";
import { newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";
import { clearRateLimits } from "./support/local-db";
import { createTemplate } from "./support/automation";

test.setTimeout(90_000);
test.beforeEach(() => clearRateLimits());

test("Criador IA: abre modal de criação, seleciona sugestão e cancela", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Automação IA");
  await gotoReady(page, "/automacoes");

  // Botão "Criar com IA" na barra superior
  const aiButton = page.getByRole("button", { name: "Criar com IA" });
  await expect(aiButton).toBeVisible();
  await aiButton.click();

  // Verifica que o modal abriu com título e sugestões
  await expect(page.getByRole("heading", { name: "Criar automação com IA" })).toBeVisible();
  await expect(page.getByText("O que este fluxo deve fazer?")).toBeVisible();

  // Clica em uma sugestão rápida de prompt
  const vipButton = page.getByRole("button", { name: "Qualificação VIP" });
  await expect(vipButton).toBeVisible();
  await vipButton.click();

  // O campo de texto deve ser preenchido
  const textarea = page.locator("#ai-prompt");
  await expect(textarea).toHaveValue(/VIP/);

  // Fecha o modal pelo botão Cancelar
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("heading", { name: "Criar automação com IA" })).not.toBeVisible();
});

test("Criador IA: transição a partir de Nova Automação não fecha sozinho", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Automação IA 2");
  await gotoReady(page, "/automacoes");

  // Clica no botão "Nova automação" para abrir a lista de templates
  await page.getByRole("button", { name: "Nova automação", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nova automação" })).toBeVisible();

  // Clica no card "Criar com IA" dentro do modal de modelos
  const cardAi = page.getByRole("dialog").getByRole("button", { name: /Criar com IA/ });
  await expect(cardAi).toBeVisible();
  await cardAi.click();

  // Garante que o diálogo de IA permaneceu aberto (evitando regressão do foco no Base UI)
  await expect(page.getByRole("heading", { name: "Criar automação com IA" })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole("heading", { name: "Criar automação com IA" })).toBeVisible();
});

test("Criador IA: editor de automação possui botão Ajustar com IA", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Automação IA 3");

  // Cria uma automação a partir de modelo
  await createTemplate(page, "Boas-vindas simples");

  // Verifica que o botão "Ajustar com IA" está visível no cabeçalho
  const refineButton = page.getByRole("button", { name: "Ajustar com IA" });
  await expect(refineButton).toBeVisible();
  await refineButton.click();

  // Verifica que o modal abriu no modo de ajuste/refinamento
  await expect(page.getByRole("heading", { name: "Ajustar fluxo com IA" })).toBeVisible();
  await expect(page.getByText("Diga o que deseja alterar ou adicionar ao fluxo atual.")).toBeVisible();

  // Cancela
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("heading", { name: "Ajustar fluxo com IA" })).not.toBeVisible();
});
