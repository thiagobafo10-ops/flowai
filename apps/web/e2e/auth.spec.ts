import { test, expect } from "@playwright/test";
const email = () => `e2e+${Date.now()}${Math.random().toString(16).slice(2, 6)}@flowai.test`;

test("cadastro leva ao onboarding", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana Souza");
  await page.getByLabel("E-mail").fill(email());
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("e-mail já cadastrado mostra erro e não avança", async ({ page, context }) => {
  const e = email();
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana");
  await page.getByLabel("E-mail").fill(e);
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await context.clearCookies();
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana");
  await page.getByLabel("E-mail").fill(e);
  await page.getByLabel("Senha").fill("senha-segura-123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Este e-mail já está cadastrado.").first()).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
});

test("senha errada mostra erro genérico", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("ninguem@flowai.test");
  await page.getByLabel("Senha").fill("errada-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha inválidos.").first()).toBeVisible();
});

test("rota protegida sem sessão redireciona para login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
