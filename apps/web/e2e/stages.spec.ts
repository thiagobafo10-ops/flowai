import { test, expect, type Page } from "@playwright/test";
import { addMember, clearRateLimits, deleteDealByTitle, seedDeal } from "./support/local-db";
import { newEmail, signUp, signUpWithOrg } from "./support/auth";
import { gotoReady, settled } from "./support/nav";

test.beforeEach(() => clearRateLimits());

const stagesList = (page: Page) => page.getByTestId("stages-settings");
const column = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const stageRow = (page: Page, name: string) =>
  page.getByRole("listitem", { name: `Etapa ${name}`, exact: true });

async function kanbanOrder(page: Page): Promise<string[]> {
  await gotoReady(page, "/pipeline");
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
  await expect(column(page, "Novo")).toBeVisible();
  return page.getByRole("region").evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? "").filter((l) => l && !l.startsWith("Notifications")),
  );
}

test("etapas: renomear, adicionar, reordenar, excluir movendo deals e marcar Ganho", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Etapas");

  // Um contato com deal em "Qualificado".
  await gotoReady(page, "/contatos");
  await page.getByRole("button", { name: "Novo contato" }).first().click();
  const cd = page.getByRole("dialog", { name: "Novo contato" });
  await cd.getByLabel("Nome", { exact: true }).fill("Ana");
  await cd.getByRole("button", { name: "Salvar" }).click();
  await expect(cd).toBeHidden();
  await gotoReady(page, "/pipeline");
  await column(page, "Qualificado").getByRole("button", { name: "Novo deal" }).click();
  const dd = page.getByRole("dialog", { name: "Novo deal" });
  await dd.getByLabel("Contato").fill("Ana");
  await dd.getByRole("button", { name: /Ana/ }).click();
  await dd.getByRole("button", { name: "Salvar" }).click();
  await expect(dd).toBeHidden();

  await gotoReady(page, "/configuracoes/pipeline");
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
  await expect(stageRow(page, "Qualificado")).toContainText("1 deal");
  await expect(stageRow(page, "Ganho")).toContainText("Ganho");

  // Renomear.
  const orc = stageRow(page, "Orçamento");
  await orc.getByLabel("Nome da etapa").fill("Proposta");
  await orc.getByRole("button", { name: "Salvar" }).click();
  await expect(stageRow(page, "Proposta")).toBeVisible();
  // Nome repetido.
  const prop = stageRow(page, "Proposta");
  await prop.getByLabel("Nome da etapa").fill("novo");
  await prop.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Já existe uma etapa com este nome.").first()).toBeVisible();
  await prop.getByLabel("Nome da etapa").fill("Proposta");

  // Adicionar.
  await page.getByRole("button", { name: "Adicionar etapa" }).click();
  const add = page.getByRole("dialog", { name: "Adicionar etapa" });
  await add.getByLabel("Nome").fill("Demonstração");
  await add.getByRole("button", { name: "Adicionar" }).click();
  await expect(add).toBeHidden();
  await expect(stageRow(page, "Demonstração")).toBeVisible();

  // Descer "Novo".
  await stageRow(page, "Novo").getByRole("button", { name: "Descer" }).click();
  await expect(stageRow(page, "Interessado").getByRole("button", { name: "Subir" })).toBeVisible();
  await settled(stagesList(page));
  await expect
    .poll(async () => (await kanbanOrder(page)).join(","))
    .toBe("Interessado,Novo,Qualificado,Proposta,Negociação,Demonstração,Ganho,Perdido");

  // Excluir "Qualificado" movendo o deal para "Novo".
  await gotoReady(page, "/configuracoes/pipeline");
  await stageRow(page, "Qualificado").getByRole("button", { name: "Ações da etapa Qualificado" }).click();
  await page.getByRole("menuitem", { name: "Excluir etapa" }).click();
  const del = page.getByRole("dialog", { name: "Excluir etapa" });
  await expect(del.getByText("Mover 1 deal para:")).toBeVisible();
  await expect(del.getByRole("button", { name: "Excluir" })).toBeDisabled();
  await del.getByLabel("Etapa de destino").selectOption({ label: "Novo" });
  await del.getByRole("button", { name: "Excluir" }).click();
  await expect(del).toBeHidden();
  await expect(stageRow(page, "Qualificado")).toHaveCount(0);
  await gotoReady(page, "/pipeline");
  await expect(column(page, "Novo").getByRole("group", { name: /Ana/ })).toBeVisible();

  // Etapa de Ganho não pode ser excluída.
  await gotoReady(page, "/configuracoes/pipeline");
  await stageRow(page, "Ganho").getByRole("button", { name: "Ações da etapa Ganho" }).click();
  await expect(page.getByRole("menuitem", { name: "Excluir etapa" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Marcar "Negociação" como Ganho.
  await stageRow(page, "Negociação").getByRole("button", { name: "Ações da etapa Negociação" }).click();
  await page.getByRole("menuitem", { name: "Marcar como Ganho" }).click();
  await expect(stageRow(page, "Negociação").getByText("Ganho", { exact: true })).toBeVisible();
  await expect(stageRow(page, "Ganho").getByText("Ganho", { exact: true })).toHaveCount(0);
});

test("etapas: reordenar pelo teclado na alça de arrastar", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Etapas Teclado");
  await gotoReady(page, "/configuracoes/pipeline");
  const handle = page.getByRole("button", { name: "Arrastar etapa Novo", exact: true });
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("aria-roledescription", "reordenável");
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Sobre a etapa Novo.")).toBeAttached();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("Sobre a etapa Interessado.")).toBeAttached();
  await page.keyboard.press("Space");
  await expect(page.getByText("Etapa solta na posição de Interessado.")).toBeAttached();
  await settled(stagesList(page));
  await expect
    .poll(async () => (await kanbanOrder(page)).join(","))
    .toBe("Interessado,Novo,Qualificado,Orçamento,Negociação,Ganho,Perdido");
  await gotoReady(page, "/configuracoes/pipeline");
  const items = page.getByRole("listitem", { name: /^Etapa / });
  await expect(items.nth(0)).toHaveAttribute("aria-label", "Etapa Interessado");
  await expect(items.nth(1)).toHaveAttribute("aria-label", "Etapa Novo");
});

test("etapas: agente não acessa o editor", async ({ page, browser }) => {
  const ownerEmail = newEmail();
  const agentEmail = newEmail();
  await signUpWithOrg(page, ownerEmail, "Org Etapas Agente");
  const ctx = await browser.newContext();
  const agent = await ctx.newPage();
  await signUp(agent, agentEmail);
  addMember(ownerEmail, agentEmail, "agent");
  await gotoReady(agent, "/configuracoes/pipeline");
  await expect(agent.getByText("Você não tem permissão para esta ação.")).toBeVisible();
  await expect(agent.getByRole("button", { name: "Adicionar etapa" })).toHaveCount(0);
  await ctx.close();
});

test("etapas: trocar o Ganho pede confirmação e explica conflito de deal aberto", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Etapas Ganho");
  seedDeal(email, "Ana", "Negociação", "Deal Ana");
  seedDeal(email, "Bia", "Ganho", "Deal Bia ganho");

  await gotoReady(page, "/configuracoes/pipeline");
  await stageRow(page, "Negociação").getByRole("button", { name: "Ações da etapa Negociação" }).click();
  await page.getByRole("menuitem", { name: "Marcar como Ganho" }).click();
  const confirm = page.getByRole("dialog", { name: "Marcar como Ganho" });
  await expect(confirm).toContainText(
    "1 deal de Negociação será marcado como ganho e 1 deal de Ganho voltará a ficar aberto.",
  );
  // Cancelar não altera nada.
  await confirm.getByRole("button", { name: "Cancelar" }).click();
  await expect(confirm).toBeHidden();
  await expect(stageRow(page, "Ganho").getByText("Ganho", { exact: true })).toBeVisible();

  // Conflito: Bia passaria a ter dois deals abertos.
  seedDeal(email, "Bia", "Novo", "Deal Bia aberto");
  await stageRow(page, "Negociação").getByRole("button", { name: "Ações da etapa Negociação" }).click();
  await page.getByRole("menuitem", { name: "Marcar como Ganho" }).click();
  await confirm.getByRole("button", { name: "Confirmar" }).click();
  await expect(
    page.getByText("Não foi possível: o contato Bia ficaria com dois deals abertos.").first(),
  ).toBeVisible();
  await settled(stagesList(page));
  await expect(stageRow(page, "Ganho").getByText("Ganho", { exact: true })).toBeVisible();

  // Sem o conflito, confirma e a marca muda.
  deleteDealByTitle(email, "Deal Bia aberto");
  await gotoReady(page, "/configuracoes/pipeline");
  await stageRow(page, "Negociação").getByRole("button", { name: "Ações da etapa Negociação" }).click();
  await page.getByRole("menuitem", { name: "Marcar como Ganho" }).click();
  await confirm.getByRole("button", { name: "Confirmar" }).click();
  await expect(confirm).toBeHidden();
  await expect(stageRow(page, "Negociação").getByText("Ganho", { exact: true })).toBeVisible();
  await expect(stageRow(page, "Ganho").getByText("Ganho", { exact: true })).toHaveCount(0);
});
