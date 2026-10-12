import { test, expect } from "@playwright/test";
import { clearRateLimits } from "./support/local-db";
import { newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady, reloadReady } from "./support/nav";

test.beforeEach(() => clearRateLimits());

test("sidebar mostra os 9 módulos na ordem e marca o ativo", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Shell");
  const nav = page.getByRole("complementary", { name: "Navegação principal" });
  await expect(nav.getByRole("link")).toHaveText([
    "Dashboard",
    "Inbox",
    "Contatos",
    "Pipeline",
    "Automações",
    "IA",
    "Conhecimento",
    "Analytics",
    "Configurações",
  ]);
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByText("Proprietário")).toBeVisible();
  await expect(nav.getByText("Org Shell")).toBeVisible();
});

test("tema escuro persiste após recarregar", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Tema");
  await page.getByRole("button", { name: "Alterar tema" }).click();
  await page.getByRole("menuitem", { name: "Escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await reloadReady(page);
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("recolher a sidebar persiste após recarregar", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Recolher");
  await page.getByRole("button", { name: "Recolher menu" }).click();
  await expect(page.getByRole("button", { name: "Expandir menu" })).toBeVisible();
  await reloadReady(page);
  await expect(page.getByRole("button", { name: "Expandir menu" })).toBeVisible();
});

test("no celular a gaveta abre e fecha ao navegar", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Celular");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("complementary", { name: "Navegação principal" })).toBeHidden();
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Contatos" }).click();
  await expect(page).toHaveURL(/\/contatos$/);
  await expect(page.getByRole("heading", { level: 1, name: "Contatos" })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("módulos não construídos mostram Em construção", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Placeholder");
  for (const [href, title, text] of [
    ["/automacoes", "Automações", "Crie fluxos automáticos de atendimento e vendas."],
  ]) {
    await gotoReady(page, href);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(text)).toBeVisible();
    await expect(page.getByText("Em construção")).toBeVisible();
  }
});

test("menu do usuário mostra e-mail e sai", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Usuário");
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Ana Souza")).toBeVisible();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
