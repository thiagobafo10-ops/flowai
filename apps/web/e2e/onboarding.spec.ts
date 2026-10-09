import { test, expect } from "@playwright/test";
import { clearRateLimits, countMemberships } from "./support/local-db";

// Cada teste cadastra um usuário; o limite de cadastro é 5/IP/hora.
test.beforeEach(() => clearRateLimits());

test("critérios 1–3: cadastro → organização → dashboard", async ({ page }) => {
  const email = `e2e+${Date.now()}@flowai.test`;
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana Souza");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Nome da empresa").fill("  Açaí & Cia!!  ");
  await page.getByRole("button", { name: "Criar organização" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("complementary", { name: "Navegação principal" }).getByText("Açaí & Cia!!")).toBeVisible();
  await expect(page.getByRole("main").getByText("Açaí & Cia!!")).toBeVisible();
  await expect(page.getByText("Ainda não há dados. Conecte um canal para começar a receber conversas.")).toBeVisible();

  // voltar ao onboarding não cria outra org
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(countMemberships(email)).toBe(1);

  // sair e entrar de novo mantém a org
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("main").getByText("Açaí & Cia!!")).toBeVisible();
});

test("nome vazio mostra erro de validação", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana");
  await page.getByLabel("E-mail").fill(`e2e+${Date.now()}x@flowai.test`);
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByLabel("Nome da empresa").fill("   ");
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page.getByText("Informe o nome da empresa.").first()).toBeVisible();
});
