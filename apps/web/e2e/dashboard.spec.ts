import { test, expect, type Page } from "@playwright/test";
import {
  breakDashboardRpc,
  clearRateLimits,
  restoreDashboardRpc,
  seedDashboardData,
} from "./support/local-db";

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

test("API do dashboard exige sessão", async ({ request }) => {
  const res = await request.get("/api/dashboard?periodo=7d", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "unauthorized" });
});

test("API devolve métricas do período", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Dashboard");
  seedDashboardData(email);

  const res = await page.request.get("/api/dashboard?periodo=30d");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = await res.json();
  expect(body.kpis.new_contacts).toBe(3);
  expect(body.series.conversations_per_day).toHaveLength(30);

  const res7 = await page.request.get("/api/dashboard?periodo=7d");
  const b7 = await res7.json();
  expect(b7.kpis.new_contacts).toBe(2);
  expect(b7.kpis.leads).toBe(3);
  expect(b7.kpis.potential_value).toBe(1000);
  expect(b7.kpis.resolution_rate).toBe(0.5);
});

test("API devolve 500 com mensagem quando a RPC falha", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Falha");
  breakDashboardRpc();
  try {
    const res = await page.request.get("/api/dashboard?periodo=7d");
    expect(res.status()).toBe(500);
    expect(await res.json()).toEqual({ error: "Não foi possível carregar o dashboard." });
  } finally {
    restoreDashboardRpc();
  }
});

const kpi = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("organização nova mostra banner e zeros", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Vazia");
  await expect(
    page.getByText("Ainda não há dados. Conecte um canal para começar a receber conversas."),
  ).toBeVisible();
  await expect(kpi(page, "Conversas hoje")).toContainText("0");
  await expect(kpi(page, "Taxa de resolução")).toContainText("—");
  await expect(page.getByText("Sem dados no período").first()).toBeVisible();
});

test.describe("com dados", () => {
  test.beforeEach(async ({ page }) => {
    const email = newEmail();
    await signUpWithOrg(page, email, "Org Com Dados");
    seedDashboardData(email);
    await page.goto("/dashboard");
  });

  test("mostra os números esperados (7 dias)", async ({ page }) => {
    await expect(page.getByText("Ainda não há dados.", { exact: false })).toBeHidden();
    await expect(kpi(page, "Conversas hoje")).toContainText("2");
    await expect(kpi(page, "Novos contatos")).toContainText("2");
    await expect(kpi(page, "Leads")).toContainText("3");
    await expect(kpi(page, "Oportunidades")).toContainText("1");
    await expect(kpi(page, "Valor potencial")).toContainText("R$ 1.000,00");
    await expect(kpi(page, "Atendidas por IA")).toContainText("1");
    await expect(kpi(page, "Transferências para humanos")).toContainText("1");
    await expect(kpi(page, "Taxa de resolução")).toContainText("50,0%");
    await expect(kpi(page, "Conversão")).toContainText("50,0%");
  });

  test("trocar para 30 dias atualiza cards e URL", async ({ page }) => {
    await page.getByRole("radio", { name: "30 dias" }).click();
    await expect(page).toHaveURL(/periodo=30d/);
    await expect(kpi(page, "Novos contatos")).toContainText("3");
    await expect(kpi(page, "Novos contatos")).toContainText("últimos 30 dias");
  });

  test("erro mostra Tentar novamente e recupera", async ({ page }) => {
    breakDashboardRpc();
    try {
      await page.getByRole("radio", { name: "Hoje" }).click();
      await expect(page.getByText("Não foi possível carregar o dashboard.")).toBeVisible();
    } finally {
      restoreDashboardRpc();
    }
    await page.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(kpi(page, "Conversas hoje")).toContainText("2");
  });
});
