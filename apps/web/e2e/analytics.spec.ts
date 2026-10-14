import { test, expect } from "@playwright/test";
import { newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";
import { clearRateLimits } from "./support/local-db";

test.setTimeout(90_000);
test.beforeEach(() => clearRateLimits());

test("API de analytics exige sessão autenticada", async ({ request }) => {
  const res = await request.get("/api/analytics?periodo=30d", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("Analytics: navegação, alternância de períodos e abas", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Analytics");
  await gotoReady(page, "/analytics");

  // Cabeçalho e título
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(
    page.getByText("Indicadores de atendimento, inteligência artificial e conversão de vendas."),
  ).toBeVisible();

  // Seletor de período
  const btn7d = page.getByRole("button", { name: "7 dias" });
  const btn30d = page.getByRole("button", { name: "30 dias" });
  const btn90d = page.getByRole("button", { name: "90 dias" });
  const btn1d = page.getByRole("button", { name: "Hoje" });

  await expect(btn7d).toBeVisible();
  await expect(btn30d).toBeVisible();
  await expect(btn90d).toBeVisible();
  await expect(btn1d).toBeVisible();

  // Alterna para 7 dias
  await btn7d.click();
  await expect(page).toHaveURL(/periodo=7d/);

  // Cards de resumo
  await expect(page.getByText("Total de Conversas")).toBeVisible();
  await expect(page.getByText("Taxa de Resolução")).toBeVisible();
  await expect(page.getByText("Contenção da IA")).toBeVisible();
  await expect(page.getByText("Vendas Ganhas")).toBeVisible();

  // Abas de navegação
  const tabConversations = page.getByRole("tab", { name: "Atendimento & Conversas" });
  const tabAi = page.getByRole("tab", { name: "Inteligência Artificial" });
  const tabCrm = page.getByRole("tab", { name: "Vendas & Funil do CRM" });

  await expect(tabConversations).toBeVisible();
  await expect(tabAi).toBeVisible();
  await expect(tabCrm).toBeVisible();

  // Aba Atendimento: gráficos visíveis
  await expect(page.getByRole("heading", { name: "Volume Diário de Atendimento" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Atendimento por Canal" })).toBeVisible();

  // Alterna para IA
  await tabAi.click();
  await expect(page.getByRole("heading", { name: "Respostas da IA vs Intervenções Humanas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Principais Motivos de Transferência" })).toBeVisible();

  // Alterna para Vendas & CRM
  await tabCrm.click();
  await expect(page.getByRole("heading", { name: "Funil de Vendas por Etapa" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Criação vs Fechamento de Vendas" })).toBeVisible();

  // Botão Exportar CSV está habilitado
  const exportBtn = page.getByRole("button", { name: "Exportar CSV" });
  await expect(exportBtn).toBeVisible();
  await expect(exportBtn).toBeEnabled();
});
