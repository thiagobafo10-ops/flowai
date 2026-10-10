import { test, expect, type Page } from "@playwright/test";
import { clearRateLimits, seedContacts } from "./support/local-db";

const PASSWORD = "senha-segura-123";
test.beforeEach(() => clearRateLimits());

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

test("lista, criação, duplicidade, busca e filtros", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Contatos");
  await page.goto("/contatos");
  await expect(page.getByRole("heading", { name: "Contatos" })).toBeVisible();
  await expect(page.getByText("Nenhum contato ainda")).toBeVisible();

  // Cria João Silva com tag nova VIP e status Cliente.
  await page.getByRole("button", { name: "Novo contato" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Novo contato" });
  await dialog.getByLabel("Nome", { exact: true }).fill("João Silva");
  await dialog.getByLabel("Telefone").fill("(11) 99999-8888");
  await dialog.getByLabel("Status").selectOption("customer");
  await dialog.getByLabel("Nova tag").fill("VIP");
  await dialog.getByRole("button", { name: "Criar tag" }).click();
  await expect(dialog.getByRole("button", { name: "VIP", pressed: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Contato salvo.").first()).toBeVisible();
  await expect(dialog).toBeHidden();

  const row = page.getByRole("row", { name: /João Silva/ });
  await expect(row).toContainText("(11) 99999-8888");
  await expect(row).toContainText("Cliente");
  await expect(row).toContainText("VIP");

  // Mesmo telefone em outro formato → aviso não bloqueante.
  await page.getByRole("button", { name: "Novo contato" }).first().click();
  const dialog2 = page.getByRole("dialog", { name: "Novo contato" });
  await dialog2.getByLabel("Nome", { exact: true }).fill("Maria Duplicada");
  await dialog2.getByLabel("Telefone").fill("+55 11 99999-8888");
  await dialog2.getByRole("button", { name: "Salvar" }).click();
  await expect(
    page.getByText("Já existe um contato com este telefone/e-mail").first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "João Silva" }).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("row", { name: /Maria Duplicada/ })).toBeVisible();

  // Só e-mail → o e-mail é o nome exibido.
  await page.getByRole("button", { name: "Novo contato" }).first().click();
  const dialog3 = page.getByRole("dialog", { name: "Novo contato" });
  await dialog3.getByLabel("E-mail").fill("so.email@exemplo.com");
  await dialog3.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog3).toBeHidden();
  await expect(page.getByRole("row", { name: /so\.email@exemplo\.com/ })).toBeVisible();

  // Busca sem acento.
  await page.getByRole("searchbox", { name: "Buscar contatos" }).fill("joao");
  await expect(page).toHaveURL(/q=joao/);
  await expect(page.getByRole("row", { name: /João Silva/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /Maria Duplicada/ })).toHaveCount(0);

  // Filtro por status + limpar.
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await page.getByLabel("Status", { exact: true }).selectOption("customer");
  await expect(page).toHaveURL(/status=customer/);
  await expect(page.getByRole("row", { name: /João Silva/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /so\.email@exemplo\.com/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page.getByRole("row", { name: /so\.email@exemplo\.com/ })).toBeVisible();

  // Sem resultados com filtro.
  await page.getByRole("searchbox", { name: "Buscar contatos" }).fill("zzzzz");
  await expect(page.getByText("Nenhum contato encontrado")).toBeVisible();
});

test("paginação por URL", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Paginação");
  seedContacts(email, 30);
  await page.goto("/contatos?ordem=nome");
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await page.getByRole("link", { name: "Próxima" }).click();
  await expect(page).toHaveURL(/pagina=2/);
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await expect(page.getByRole("row", { name: /Contato 30/ })).toBeVisible();

  // Página além do fim volta para a primeira.
  await page.goto("/contatos?pagina=99");
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await expect(page).not.toHaveURL(/pagina=99/);
});
