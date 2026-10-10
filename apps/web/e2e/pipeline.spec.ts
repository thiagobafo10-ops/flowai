import { test, expect, type Locator, type Page } from "@playwright/test";
import { addMember, clearRateLimits, deleteDealByTitle } from "./support/local-db";
import { newEmail, signUp, signUpWithOrg } from "./support/auth";
import { gotoReady, reloadReady, settled } from "./support/nav";

test.beforeEach(() => clearRateLimits());

const board = (page: Page) => page.getByTestId("pipeline-board");

async function createContact(page: Page, name: string): Promise<string> {
  await gotoReady(page, "/contatos");
  await page.getByRole("button", { name: "Novo contato" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Novo contato" });
  await dialog.getByLabel("Nome", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  const href = await page.getByRole("link", { name, exact: true }).first().getAttribute("href");
  return href!.split("/").pop()!;
}

const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

async function createDeal(page: Page, stage: string, contact: string, value: string) {
  await column(page, stage).getByRole("button", { name: "Novo deal" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo deal" });
  await dialog.getByLabel("Contato").fill(contact);
  await dialog.getByRole("button", { name: new RegExp(contact) }).click();
  await expect(dialog.getByLabel("Título")).toHaveValue(`Oportunidade — ${contact}`);
  await dialog.getByLabel("Valor").fill(value);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
}

async function drag(page: Page, card: Locator, target: Locator) {
  // Nada pode estar por cima do card (diálogo ou menu abertos interceptam o ponteiro).
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await card.hover();
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 20 });
  await expect(target).toHaveAttribute("data-over", "true");
  await page.mouse.up();
}

const kpi = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("cria, arrasta, move pelo menu, exclui e bloqueia deal duplicado", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Pipeline");
  const anaId = await createContact(page, "Ana");
  await createContact(page, "Bia");
  await gotoReady(page, "/pipeline");
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();

  await createDeal(page, "Novo", "Ana", "1.500,00");
  const ana = column(page, "Novo").getByRole("group", { name: "Oportunidade — Ana" });
  await expect(ana).toBeVisible();
  await expect(column(page, "Novo")).toContainText(/1 deal · R\$\s1\.500,00/);

  // Plural + exclusão com confirmação.
  await createDeal(page, "Novo", "Bia", "500");
  await expect(column(page, "Novo")).toContainText(/2 deals · R\$\s2\.000,00/);
  await column(page, "Novo").getByRole("group", { name: "Oportunidade — Bia" }).click();
  const edit = page.getByRole("dialog", { name: "Deal" });
  await edit.getByRole("button", { name: "Excluir deal" }).click();
  await edit.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(edit).toBeHidden();
  await expect(column(page, "Novo")).toContainText(/1 deal · R\$\s1\.500,00/);

  // Arrastar para "Interessado" persiste.
  await drag(page, ana, column(page, "Interessado"));
  await expect(
    column(page, "Interessado").getByRole("group", { name: "Oportunidade — Ana" }),
  ).toBeVisible();
  await settled(board(page));
  await reloadReady(page);
  await expect(
    column(page, "Interessado").getByRole("group", { name: "Oportunidade — Ana" }),
  ).toBeVisible();
  await gotoReady(page, "/dashboard");
  await expect(kpi(page, "Oportunidades").getByText("1", { exact: true })).toBeVisible();

  // Contato com deal aberto aparece desabilitado; forçar pela URL mostra o erro do servidor.
  await gotoReady(page, "/pipeline");
  await column(page, "Novo").getByRole("button", { name: "Novo deal" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo deal" });
  await dialog.getByLabel("Contato").fill("Ana");
  const option = dialog.getByRole("button", { name: /Ana/ });
  await expect(option).toBeDisabled();
  await expect(option).toContainText("já tem deal aberto");
  await page.keyboard.press("Escape");
  await gotoReady(page, `/pipeline?novo=${anaId}`);
  const forced = page.getByRole("dialog", { name: "Novo deal" });
  await expect(forced).toContainText("Ana");
  await forced.getByRole("button", { name: "Salvar" }).click();
  await expect(forced.getByRole("alert")).toHaveText("Este contato já tem um deal aberto.");
  await page.keyboard.press("Escape");

  // "Mover para…" → Ganho.
  const card = column(page, "Interessado").getByRole("group", { name: "Oportunidade — Ana" });
  await card.getByRole("button", { name: "Mover deal" }).click();
  await page.getByRole("menuitem", { name: "Ganho" }).click();
  await expect(column(page, "Ganho").getByRole("group", { name: "Oportunidade — Ana" })).toBeVisible();
  await settled(board(page));
  await gotoReady(page, "/dashboard");
  await expect(kpi(page, "Conversão").getByText("100,0%", { exact: true })).toBeVisible();
});

test("mover deal já excluído por outra pessoa mostra erro e atualiza o quadro", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Pipeline Stale");
  await createContact(page, "Ana");
  await gotoReady(page, "/pipeline");
  await createDeal(page, "Novo", "Ana", "100");
  const card = column(page, "Novo").getByRole("group", { name: "Oportunidade — Ana" });
  await expect(card).toBeVisible();

  deleteDealByTitle(email, "Oportunidade — Ana");

  await card.getByRole("button", { name: "Mover deal" }).click();
  await page.getByRole("menuitem", { name: "Interessado" }).click();
  await expect(page.getByText("Este deal não existe mais.").first()).toBeVisible();
  await expect(page.getByRole("group", { name: "Oportunidade — Ana" })).toHaveCount(0);
});

test("ficha do contato: Criar deal abre o diálogo com o contato", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Pipeline Ficha");
  const id = await createContact(page, "Ana");
  await gotoReady(page, `/contatos/${id}`);
  await page.getByRole("link", { name: "Criar deal" }).click();
  await expect(page).toHaveURL(/\/pipeline\?novo=/);
  const dialog = page.getByRole("dialog", { name: "Novo deal" });
  await expect(dialog).toContainText("Ana");
  await expect(dialog.getByLabel("Título")).toHaveValue("Oportunidade — Ana");
  await dialog.getByLabel("Valor").fill("2.000");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/novo=/);
  await expect(column(page, "Novo").getByRole("group", { name: "Oportunidade — Ana" })).toBeVisible();
});

test("teclado: menu, título e arrasto não conflitam", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Pipeline Teclado");
  await createContact(page, "Ana");
  await gotoReady(page, "/pipeline");
  await createDeal(page, "Novo", "Ana", "100");
  const card = column(page, "Novo").getByRole("group", { name: "Oportunidade — Ana" });

  // Enter no botão "Mover deal" abre o menu (não inicia arrasto).
  await card.getByRole("button", { name: "Mover deal" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Interessado" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Interessado" }).click();
  const moved = column(page, "Interessado").getByRole("group", { name: "Oportunidade — Ana" });
  await expect(moved).toBeVisible();

  // Enter no título abre o diálogo.
  await moved.getByRole("button", { name: "Oportunidade — Ana" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Deal" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // Espaço no card + seta direita + espaço move uma coluna.
  await moved.focus();
  await page.keyboard.press("Space");
  await expect(moved).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  // A seta saltou para a coluna seguinte: a etapa atual deixa de ser o alvo.
  await expect(column(page, "Interessado")).toHaveAttribute("data-over", "false");
  await page.keyboard.press("Space");
  await expect(column(page, "Interessado").getByRole("group", { name: "Oportunidade — Ana" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Oportunidade — Ana" })).toHaveCount(1);
});

test("API do pipeline exige sessão", async ({ request }) => {
  const res = await request.get("/api/pipeline", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});

test("visualizador não arrasta nem move; diálogo é somente leitura", async ({ page, browser, baseURL }) => {
  const ownerEmail = newEmail();
  await signUpWithOrg(page, ownerEmail, "Org Pipeline Viewer");
  await createContact(page, "Ana");
  await gotoReady(page, "/pipeline");
  await createDeal(page, "Novo", "Ana", "100");

  const viewerEmail = newEmail();
  const ctx = await browser.newContext({ baseURL });
  try {
    const vp = await ctx.newPage();
    await signUp(vp, viewerEmail, "Vera Viewer");
    addMember(ownerEmail, viewerEmail, "viewer");
    await gotoReady(vp, "/pipeline");
    const card = column(vp, "Novo").getByRole("group", { name: "Oportunidade — Ana" });
    await expect(card).toBeVisible();
    await expect(vp.getByRole("button", { name: "Mover deal" })).toHaveCount(0);
    await expect(vp.getByRole("button", { name: "Novo deal" })).toHaveCount(0);
    await card.click();
    const dialog = vp.getByRole("dialog", { name: "Deal" });
    await expect(dialog.getByLabel("Título")).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Salvar" })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Excluir deal" })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
