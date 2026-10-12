import { test, expect } from "@playwright/test";
import { newEmail, signUpWithOrg, signUp } from "./support/auth";
import { addMember, clearRateLimits, simulateInboundSql } from "./support/local-db";
import { gotoReady, settled } from "./support/nav";

test.beforeEach(() => clearRateLimits());

test("contador de não lidas exige sessão", async ({ request }) => {
  expect((await request.get("/api/inbox/nao-lidas")).status()).toBe(401);
});

test("contador inicial é zero para uma organização nova", async ({ page }) => {
  await signUpWithOrg(page, newEmail(), "Org Contador");
  const response = await page.request.get("/api/inbox/nao-lidas");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ count: 0 });
});

test("mensagem recebida atualiza Inbox e contador de outro membro sem recarregar", async ({ page, browser }) => {
  const owner = newEmail();
  await signUpWithOrg(page, owner, "Org Tempo Real");
  const context = await browser.newContext();
  const agent = await context.newPage();
  try {
    const email = newEmail();
    await signUp(agent, email, "Bruno Lima");
    addMember(owner, email, "agent");
    await gotoReady(agent, "/inbox");
    await expect(agent.getByText("Nenhuma conversa ainda")).toBeVisible();
    simulateInboundSql(owner, { name: "Carla Realtime", phone: "5511988887777", text: "Oi em tempo real" });
    await expect(agent.getByText("Carla Realtime").first()).toBeVisible({ timeout: 15000 });
    await expect(agent.getByLabel("1 conversas não lidas").first()).toBeVisible();
    const body = await (await agent.request.get("/api/inbox")).json();
    await gotoReady(page, `/inbox?c=${body.items[0].id}`);
    await gotoReady(agent, `/inbox?c=${body.items[0].id}`);
    await settled(page.getByRole("region", { name: "Conversa", exact: true }));
    await settled(agent.getByRole("region", { name: "Conversa", exact: true }));
    await agent.getByLabel("Escreva sua mensagem", { exact: true }).fill("Resposta ao vivo");
    await agent.getByRole("button", { name: "Enviar", exact: true }).click();
    await expect(page.getByText("Resposta ao vivo", { exact: true })).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => (await (await page.request.get("/api/inbox/nao-lidas")).json()).count).toBe(0);
    await settled(page.getByRole("region", { name: "Conversa", exact: true }));
    await settled(agent.getByRole("region", { name: "Conversa", exact: true }));
    await Promise.all([
      page.getByRole("button", { name: "Assumir", exact: true }).click(),
      agent.getByRole("button", { name: "Assumir", exact: true }).click(),
    ]);
    const selectedId = body.items[0].id;
    await expect.poll(async () => {
      const ownerDetail = await (await page.request.get(`/api/inbox/${selectedId}`)).json();
      const agentDetail = await (await agent.request.get(`/api/inbox/${selectedId}`)).json();
      const name = ownerDetail.conversation.assignedTo?.name;
      if (!name || name !== agentDetail.conversation.assignedTo?.name) return false;
      return await page.getByRole("region", { name: "Conversa", exact: true }).locator("header").getByText(name, { exact: true }).isVisible()
        && await agent.getByRole("region", { name: "Conversa", exact: true }).locator("header").getByText(name, { exact: true }).isVisible();
    }, { timeout: 15000 }).toBe(true);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(agent.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
    await expect(agent.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
