import { test, expect } from "@playwright/test";
import {
  breakMembershipsRead,
  clearRateLimits,
  countAuditLogins,
  countMemberships,
  restoreMembershipsRead,
} from "./support/local-db";
import { PASSWORD, newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";

// Cada teste cadastra um usuário; o limite de cadastro é 5/IP/hora.
test.beforeEach(() => clearRateLimits());

test("erro do banco mostra tela de erro e não leva ao onboarding", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Resiliente");

  breakMembershipsRead();
  try {
    await gotoReady(page, "/dashboard");
    await expect(page.getByText("Não foi possível carregar seus dados.")).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);

    await gotoReady(page, "/onboarding");
    await expect(page.getByText("Não foi possível carregar seus dados.")).toBeVisible();
    await expect(page.getByLabel("Nome da empresa")).toHaveCount(0);
  } finally {
    restoreMembershipsRead();
  }
  expect(countMemberships(email)).toBe(1);

  await gotoReady(page, "/dashboard");
  await expect(page.getByRole("main").getByText("Org Resiliente")).toBeVisible();
});

test("botão Tentar novamente recupera após falha transitória", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Retry");
  breakMembershipsRead();
  try {
    await gotoReady(page, "/dashboard");
    await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
  } finally {
    restoreMembershipsRead();
  }
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("main").getByText("Org Retry")).toBeVisible();
});

test("login grava auditoria auth.login e sair remove o cookie de organização", async ({ page, context }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Cookie");
  expect((await context.cookies()).some((c) => c.name === "flowai_org")).toBe(true);

  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).some((c) => c.name === "flowai_org")).toBe(false);

  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(countAuditLogins(email)).toBe(1);
});

test("nome curto no cadastro mostra a mensagem do schema", async ({ page }) => {
  await gotoReady(page, "/signup");
  await page.getByLabel("Nome completo").fill("A");
  await page.getByLabel("E-mail").fill(newEmail());
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Informe seu nome completo.", { exact: true })).toBeVisible();
});
