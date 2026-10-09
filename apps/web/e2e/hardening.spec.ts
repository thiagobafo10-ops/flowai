import { test, expect, type Page } from "@playwright/test";
import {
  breakMembershipsRead,
  countAuditLogins,
  countMemberships,
  restoreMembershipsRead,
} from "./support/local-db";

const PASSWORD = "senha-segura-123";
const newEmail = () => `e2e+${Date.now()}${Math.random().toString(16).slice(2, 6)}@flowai.test`;

async function signUpWithOrg(page: Page, email: string, orgName: string) {
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana Souza");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Nome da empresa").fill(orgName);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("erro do banco mostra tela de erro e não leva ao onboarding", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Resiliente");

  breakMembershipsRead();
  try {
    await page.goto("/dashboard");
    await expect(page.getByText("Não foi possível carregar seus dados.")).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/onboarding");
    await expect(page.getByText("Não foi possível carregar seus dados.")).toBeVisible();
    await expect(page.getByLabel("Nome da empresa")).toHaveCount(0);
  } finally {
    restoreMembershipsRead();
  }
  expect(countMemberships(email)).toBe(1);

  await page.goto("/dashboard");
  await expect(page.getByRole("banner").getByText("Org Resiliente")).toBeVisible();
});

test("botão Tentar novamente recupera após falha transitória", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Retry");
  breakMembershipsRead();
  try {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
  } finally {
    restoreMembershipsRead();
  }
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("banner").getByText("Org Retry")).toBeVisible();
});

test("login grava auditoria auth.login e sair remove o cookie de organização", async ({ page, context }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Cookie");
  expect((await context.cookies()).some((c) => c.name === "flowai_org")).toBe(true);

  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).some((c) => c.name === "flowai_org")).toBe(false);

  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(countAuditLogins(email)).toBe(1);
});

test("nome curto no cadastro mostra a mensagem do schema", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("A");
  await page.getByLabel("E-mail").fill(newEmail());
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByText("Informe seu nome completo.", { exact: true })).toBeVisible();
});
