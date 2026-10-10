import { test, expect, type Page } from "@playwright/test";
import { addMember, clearRateLimits, seedContacts } from "./support/local-db";
import { newEmail, signUp, signUpWithOrg } from "./support/auth";
import { gotoReady, reloadReady, settled } from "./support/nav";

test.beforeEach(() => clearRateLimits());

const tagsCard = (page: Page) => page.getByRole("region", { name: "Tags", exact: true });
const fieldsCard = (page: Page) => page.getByRole("region", { name: "Campos personalizados", exact: true });

test("lista, criação, duplicidade, busca e filtros", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Contatos");
  await gotoReady(page, "/contatos");
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
  await gotoReady(page, "/contatos?ordem=nome");
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await page.getByRole("link", { name: "Próxima" }).click();
  await expect(page).toHaveURL(/pagina=2/);
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await expect(page.getByRole("row", { name: /Contato 30/ })).toBeVisible();

  // Página além do fim volta para a primeira.
  await gotoReady(page, "/contatos?pagina=99");
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  await expect(page).not.toHaveURL(/pagina=99/);
});

async function createJoao(page: Page) {
  await gotoReady(page, "/contatos");
  await page.getByRole("button", { name: "Novo contato" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Novo contato" });
  await dialog.getByLabel("Nome", { exact: true }).fill("João Silva");
  await dialog.getByLabel("Telefone").fill("(11) 99999-8888");
  await dialog.getByLabel("Nova tag").fill("VIP");
  await dialog.getByRole("button", { name: "Criar tag" }).click();
  await expect(dialog.getByRole("button", { name: "VIP", pressed: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  const href = await page.getByRole("link", { name: "João Silva" }).first().getAttribute("href");
  await gotoReady(page, href!);
  await expect(page).toHaveURL(/\/contatos\/[0-9a-f-]{36}$/);
}

test("ficha: dados, campos, tags, edição e exclusão", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Ficha");
  await createJoao(page);

  await expect(page.getByRole("heading", { name: "João Silva" })).toBeVisible();
  await expect(page.getByText("(11) 99999-8888").first()).toBeVisible();
  await expect(page.getByText("VIP").first()).toBeVisible();
  await expect(page.getByText("Contato criado")).toBeVisible();
  await expect(page.getByText("Nenhuma conversa ainda.")).toBeVisible();

  // Campo personalizado persiste.
  await page.getByLabel("Nome do campo").fill("Cidade");
  await page.getByLabel("Valor", { exact: true }).fill("Campinas");
  await page.getByRole("button", { name: "Adicionar campo" }).click();
  await expect(page.getByText("Campinas")).toBeVisible();
  await settled(fieldsCard(page));
  await reloadReady(page);
  await expect(page.getByText("Cidade")).toBeVisible();
  await expect(page.getByText("Campinas")).toBeVisible();

  // Edição pelo diálogo.
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Editar contato" });
  await dialog.getByLabel("Nome", { exact: true }).fill("João Souza");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "João Souza" })).toBeVisible();
  // A edição preserva os campos personalizados.
  await expect(page.getByText("Campinas")).toBeVisible();

  // Remover tag pelo chip.
  await page.getByRole("button", { name: "Remover tag VIP" }).click();
  await expect(page.getByRole("button", { name: "Remover tag VIP" })).toHaveCount(0);
  await settled(tagsCard(page));
  await reloadReady(page);
  await expect(page.getByRole("button", { name: "Remover tag VIP" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "João Souza" })).toBeVisible();

  // Exclusão com confirmação.
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Excluir contato?" });
  await expect(confirm.getByText("Esta ação não pode ser desfeita.")).toBeVisible();
  await confirm.getByRole("button", { name: "Excluir" }).click();
  await expect(page).toHaveURL(/\/contatos$/);
  await expect(page.getByRole("row", { name: /João Souza/ })).toHaveCount(0);
});

test("ficha: viewer não vê ações de escrita", async ({ page, browser, baseURL }) => {
  const ownerEmail = newEmail();
  await signUpWithOrg(page, ownerEmail, "Org Ficha Viewer");
  await createJoao(page);

  const viewerEmail = newEmail();
  const ctx = await browser.newContext({ baseURL });
  try {
    const vp = await ctx.newPage();
    await signUp(vp, viewerEmail, "Vera Viewer");
    addMember(ownerEmail, viewerEmail, "viewer");
    await gotoReady(vp, "/contatos");
    await vp.getByRole("link", { name: "João Silva" }).first().click();
    await expect(vp.getByRole("heading", { name: "João Silva" })).toBeVisible();
    await expect(vp.getByText("VIP").first()).toBeVisible();
    await expect(vp.getByRole("button", { name: "Editar", exact: true })).toHaveCount(0);
    await expect(vp.getByRole("button", { name: "Excluir", exact: true })).toHaveCount(0);
    await expect(vp.getByRole("button", { name: "Adicionar tag" })).toHaveCount(0);
    await expect(vp.getByRole("button", { name: "Adicionar campo" })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test("ficha: contato inexistente", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Ficha 404");
  await gotoReady(page, "/contatos/3f0c1f0e-6a52-4a4e-9a55-1d2f7a0b9c11");
  await expect(page.getByText("Contato não encontrado")).toBeVisible();
});

test("ficha: alternar tags em sequência rápida não perde atualizações", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Ficha Tags");
  await createJoao(page);

  await page.getByRole("button", { name: "Adicionar tag" }).click();
  const picker = page.getByRole("group", { name: "Tags" });
  for (const name of ["Alfa", "Beta"]) {
    await page.getByLabel("Nova tag").fill(name);
    await page.getByRole("button", { name: "Criar tag" }).click();
    await expect(picker.getByRole("button", { name, pressed: true })).toBeVisible();
    await settled(tagsCard(page));
  }
  await reloadReady(page);
  await page.getByRole("button", { name: "Adicionar tag" }).click();
  const picker2 = page.getByRole("group", { name: "Tags" });
  await expect(picker2.getByRole("button", { name: "Alfa", pressed: true })).toBeVisible();

  // Desliga as duas em sequência, sem esperar entre os cliques.
  await picker2.getByRole("button", { name: "Alfa" }).click();
  await picker2.getByRole("button", { name: "Beta" }).click();
  await settled(tagsCard(page));
  await reloadReady(page);
  await expect(page.getByRole("button", { name: "Remover tag VIP" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remover tag Alfa" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remover tag Beta" })).toHaveCount(0);

  // Liga as duas em sequência: ambas persistem.
  await page.getByRole("button", { name: "Adicionar tag" }).click();
  const picker3 = page.getByRole("group", { name: "Tags" });
  await picker3.getByRole("button", { name: "Alfa" }).click();
  await picker3.getByRole("button", { name: "Beta" }).click();
  await settled(tagsCard(page));
  await reloadReady(page);
  await expect(page.getByRole("button", { name: "Remover tag Alfa" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remover tag Beta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remover tag VIP" })).toBeVisible();
});
