import { test, expect } from "@playwright/test";
import { clearRateLimits, countMemberships } from "./support/local-db";
import { PASSWORD, newEmail, signUp } from "./support/auth";
import { gotoReady } from "./support/nav";

// Cada teste cadastra um usuário; o limite de cadastro é 5/IP/hora.
test.beforeEach(() => clearRateLimits());

test("critérios 1–3: cadastro → organização → dashboard", async ({ page }) => {
  const email = newEmail();
  await signUp(page, email);
  await page.getByLabel("Nome da empresa").fill("  Açaí & Cia!!  ");
  await page.getByRole("button", { name: "Criar organização" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("complementary", { name: "Navegação principal" }).getByText("Açaí & Cia!!")).toBeVisible();
  await expect(page.getByRole("main").getByText("Açaí & Cia!!")).toBeVisible();
  await expect(page.getByText("Ainda não há dados. Conecte um canal para começar a receber conversas.")).toBeVisible();

  // voltar ao onboarding não cria outra org
  await gotoReady(page, "/onboarding");
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(countMemberships(email)).toBe(1);

  // sair e entrar de novo mantém a org
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("main").getByText("Açaí & Cia!!")).toBeVisible();
});

test("nome vazio mostra erro de validação", async ({ page }) => {
  await signUp(page, newEmail(), "Ana");
  await page.getByLabel("Nome da empresa").fill("   ");
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page.getByText("Informe o nome da empresa.")).toBeVisible();
});
