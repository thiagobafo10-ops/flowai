import { expect, type Page } from "@playwright/test";
import { gotoReady, waitForHydration } from "./nav";

export const PASSWORD = "senha-segura-123";

export const newEmail = () => `e2e+${Date.now()}${Math.random().toString(16).slice(2, 6)}@flowai.test`;

/** Cadastra e para no onboarding (sem organização). */
export async function signUp(page: Page, email: string, fullName = "Ana Souza"): Promise<void> {
  await gotoReady(page, "/signup");
  await page.getByLabel("Nome completo").fill(fullName);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
  await expect(page.getByLabel("Nome da empresa")).toBeVisible();
  await waitForHydration(page);
}

/** Cadastra, cria a organização e chega ao dashboard. */
export async function signUpWithOrg(page: Page, email: string, orgName: string): Promise<void> {
  await signUp(page, email);
  await page.getByLabel("Nome da empresa").fill(orgName);
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
  // The URL can update while the redirect's streamed UI is still committing.
  // Wait for the destination before starting another hard navigation.
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await waitForHydration(page);
}
