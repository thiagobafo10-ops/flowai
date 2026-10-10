import { test, expect } from "@playwright/test";
import { clearRateLimits } from "./support/local-db";
import { PASSWORD, newEmail, signUp } from "./support/auth";
import { gotoReady } from "./support/nav";

test.beforeEach(() => clearRateLimits());

test("cadastro leva ao onboarding", async ({ page }) => {
  await signUp(page, newEmail());
});

test("e-mail já cadastrado mostra erro e não avança", async ({ page, context }) => {
  const e = newEmail();
  await signUp(page, e, "Ana");
  await context.clearCookies();
  await gotoReady(page, "/signup");
  await page.getByLabel("Nome completo").fill("Ana");
  await page.getByLabel("E-mail").fill(e);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Este e-mail já está cadastrado." })).toBeVisible();
  await expect(page).toHaveURL(/\/signup$/);
});

test("senha errada mostra erro genérico", async ({ page }) => {
  await gotoReady(page, "/login");
  await page.getByLabel("E-mail").fill("ninguem@flowai.test");
  await page.getByLabel("Senha").fill("errada-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "E-mail ou senha inválidos." })).toBeVisible();
});

test("rota protegida sem sessão redireciona para login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("erro de campo é ligado ao input e não vira toast", async ({ page }) => {
  await gotoReady(page, "/signup");
  await page.getByLabel("Nome completo").fill("Ana");
  await page.getByLabel("E-mail").fill("x@flowai.test");
  await page.getByLabel("Senha").fill("123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  const senha = page.getByLabel("Senha");
  await expect(senha).toHaveAttribute("aria-invalid", "true");
  await expect(senha).toHaveAccessibleDescription("A senha deve ter pelo menos 8 caracteres.");
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
});
