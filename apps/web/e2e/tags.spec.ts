import { test, expect } from "@playwright/test";
import { addMember, clearRateLimits, psql, seedContacts } from "./support/local-db";
import { newEmail, signUp, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";

test.beforeEach(() => clearRateLimits());


test("configurações: abas e bloco Em construção", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Config");
  await gotoReady(page, "/configuracoes");
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
  await expect(page.getByText("Organização, equipe e integrações.")).toBeVisible();
  await expect(page.getByText("Em construção")).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Seções de configurações" });
  await expect(tabs.getByRole("link", { name: "Tags" })).toHaveAttribute("href", "/configuracoes/tags");
  await expect(tabs.getByRole("link", { name: "Pipeline" })).toHaveAttribute("href", "/configuracoes/pipeline");
});

test("tags: criar, duplicar, renomear, excluir e filtro de tag inexistente", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Tags");
  seedContacts(email, 3);
  await gotoReady(page, "/configuracoes/tags");
  await expect(page.getByRole("heading", { level: 1, name: "Configurações" })).toBeVisible();
  await expect(page.getByText("Nenhuma tag ainda")).toBeVisible();

  // Cria "Quente" em Vermelho.
  await page.getByRole("button", { name: "Nova tag" }).first().click();
  let dialog = page.getByRole("dialog", { name: "Nova tag" });
  await dialog.getByLabel("Nome").fill("Quente");
  await expect(dialog.getByLabel("Cor").locator("option")).toHaveText([
    "Cinza", "Vermelho", "Âmbar", "Verde", "Verde-azulado", "Azul", "Índigo", "Rosa",
  ]);
  await dialog.getByLabel("Cor").selectOption({ label: "Vermelho" });
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  const row = page.getByRole("row", { name: /Quente/ });
  await expect(row).toContainText("Vermelho");
  await expect(row.getByRole("cell").nth(2)).toHaveText("0");

  // Nome repetido (sem diferenciar maiúsculas).
  await page.getByRole("button", { name: "Nova tag" }).first().click();
  dialog = page.getByRole("dialog", { name: "Nova tag" });
  await dialog.getByLabel("Nome").fill("quente");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog.getByText("Já existe uma tag com este nome.")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();

  // Renomeia.
  await row.getByRole("button", { name: "Editar" }).click();
  dialog = page.getByRole("dialog", { name: "Editar tag" });
  await dialog.getByLabel("Nome").fill("Muito quente");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  const row2 = page.getByRole("row", { name: /Muito quente/ });
  await expect(row2).toBeVisible();

  // Guarda o id da tag antes de excluir.
  const tagId = psql(
    `select t.id from public.tags t join public.memberships m on m.organization_id = t.organization_id join auth.users u on u.id = m.user_id where u.email = '${email}' and t.name = 'Muito quente'`,
  );
  expect(tagId).toMatch(/^[0-9a-f-]{36}$/);
  await gotoReady(page, "/configuracoes/tags");
  await page.getByRole("row", { name: /Muito quente/ }).getByRole("button", { name: "Excluir" }).click();
  const confirm = page.getByRole("dialog");
  await expect(
    confirm.getByText("Excluir a tag Muito quente? Ela será removida de todos os contatos."),
  ).toBeVisible();
  await confirm.getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByRole("row", { name: /Muito quente/ })).toHaveCount(0);
  await expect(page.getByText("Nenhuma tag ainda")).toBeVisible();

  // Review Focus #5: tag inexistente na org é ignorada.
  await gotoReady(page, `/contatos?tag=${tagId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Contatos" })).toBeVisible();
  await expect(page.getByText("3 contatos")).toBeVisible();
  await expect(page.getByRole("row", { name: /Contato 01/ })).toBeVisible();
  await gotoReady(page, "/contatos?tag=00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("3 contatos")).toBeVisible();
});

test("tags: agente cria mas não edita, exclui nem vê Pipeline", async ({ page, browser }) => {
  const ownerEmail = newEmail();
  const agentEmail = newEmail();
  await signUpWithOrg(page, ownerEmail, "Org Tags Agente");
  await gotoReady(page, "/configuracoes/tags");
  await page.getByRole("button", { name: "Nova tag" }).first().click();
  const d = page.getByRole("dialog", { name: "Nova tag" });
  await d.getByLabel("Nome").fill("Existente");
  await d.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("row", { name: /Existente/ })).toBeVisible();

  const ctx = await browser.newContext();
  const agent = await ctx.newPage();
  await signUp(agent, agentEmail);
  addMember(ownerEmail, agentEmail, "agent");
  await gotoReady(agent, "/configuracoes/tags");
  await expect(agent.getByRole("row", { name: /Existente/ })).toBeVisible();
  await expect(agent.getByRole("button", { name: "Nova tag" }).first()).toBeVisible();
  await expect(agent.getByRole("button", { name: "Editar" })).toHaveCount(0);
  await expect(agent.getByRole("button", { name: "Excluir" })).toHaveCount(0);
  const agentTabs = agent.getByRole("navigation", { name: "Seções de configurações" });
  await expect(agentTabs.getByRole("link", { name: "Pipeline" })).toHaveCount(0);
  await expect(agentTabs.getByRole("link", { name: "Tags" })).toBeVisible();

  // Agente cria tag.
  await agent.getByRole("button", { name: "Nova tag" }).first().click();
  const ad = agent.getByRole("dialog", { name: "Nova tag" });
  await ad.getByLabel("Nome").fill("Do agente");
  await ad.getByRole("button", { name: "Salvar" }).click();
  await expect(agent.getByRole("row", { name: /Do agente/ })).toBeVisible();
  await ctx.close();
});
