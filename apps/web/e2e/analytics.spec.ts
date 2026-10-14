import { test, expect } from "@playwright/test";
import { newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";
import { clearRateLimits, seedDashboardData } from "./support/local-db";
import { expectAnalyticsCsv } from "./support/analytics";

test.setTimeout(90_000);
test.beforeEach(() => clearRateLimits());

test("API de analytics exige sessão autenticada", async ({ request }) => {
  const res = await request.get("/api/analytics?periodo=30d", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("Analytics: métricas persistidas e CSV baixado refletem o mesmo período", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Analytics Valores");
  // Domain triggers produce the events: 2 conversations, 1 closed, 1 human-only handoff,
  // 1 AI reply, 3 contacts (one outside 7d), open deal 1000 and won deal 500.
  seedDashboardData(email);
  const response = await page.request.get("/api/analytics?periodo=7d");
  expect(response.status()).toBe(200);
  const metrics = await response.json();
  expect(metrics.period_days).toBe(7);
  expect(metrics.summary).toMatchObject({
    total_conversations: 2, new_contacts: 2, resolution_rate: 50,
    ai_containment_rate: 100, total_pipeline_value: 1000, won_deals_value: 500,
  });
  expect(metrics.ai_section).toMatchObject({ total_ai_messages: 1, total_handoffs: 1 });
  expect(metrics.crm_section.avg_ticket).toBe(500);
  expect(metrics.conversations_section.by_status).toEqual(expect.arrayContaining([
    { status: "waiting", count: 1 }, { status: "closed", count: 1 },
  ]));
  await gotoReady(page, "/analytics?periodo=7d");
  // Next keeps an empty route-announcer alert outside main, including successful pages.
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exportar CSV" })).toBeEnabled();
  await expectAnalyticsCsv(page, "7d", {
    conversations: metrics.summary.total_conversations, contacts: metrics.summary.new_contacts,
    resolution: metrics.summary.resolution_rate, containment: metrics.summary.ai_containment_rate,
    pipeline: metrics.summary.total_pipeline_value, won: metrics.summary.won_deals_value,
    ticket: metrics.crm_section.avg_ticket,
  });
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
