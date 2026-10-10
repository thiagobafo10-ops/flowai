import { test, expect } from "@playwright/test";
import { clearRateLimits, simulateInboundSql } from "./support/local-db";
import { newEmail, signUpWithOrg } from "./support/auth";

test.beforeEach(() => clearRateLimits());

test("inbox API: 401 sem sessão", async ({ request }) => {
  const res = await request.get("/api/inbox");
  expect(res.status()).toBe(401);
});

test("inbox API: lista, contadores e aba fechadas", async ({ page }) => {
  const email = newEmail();
  await signUpWithOrg(page, email, "Org Inbox API");
  simulateInboundSql(email, { name: "Carla", phone: "5511988887777", text: "Oi, quero o preço" });
  simulateInboundSql(email, { name: "Bruno", phone: "5511977776666", text: "Olá $$ 'aspas'" });

  const res = await page.request.get("/api/inbox");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = await res.json();
  expect(body.items).toHaveLength(2);
  expect(body.counts["nao-atribuidas"]).toBe(2);
  expect(body.counts.todas).toBe(2);
  expect(body.counts.minhas).toBe(0);
  expect(body.counts.fechadas).toBe(0);
  expect(body.items[0].preview.text).toBe("Olá $$ 'aspas'");
  expect(body.items[0].channel.type).toBe("simulator");

  const closed = await (await page.request.get("/api/inbox?aba=fechadas")).json();
  expect(closed.items).toHaveLength(0);

  const search = await (await page.request.get("/api/inbox?q=carla")).json();
  expect(search.items).toHaveLength(1);
  const byPhone = await (await page.request.get("/api/inbox?q=" + encodeURIComponent("(11) 97777-6666"))).json();
  expect(byPhone.items).toHaveLength(1);
  const byText = await (await page.request.get("/api/inbox?q=pre%C3%A7o")).json();
  expect(byText.items).toHaveLength(1);

  const id = body.items[1].id;
  const detail = await page.request.get(`/api/inbox/${id}`);
  expect(detail.status()).toBe(200);
  const d = await detail.json();
  expect(d.messages).toHaveLength(1);
  expect(d.hasMore).toBe(false);
  const missing = await page.request.get("/api/inbox/00000000-0000-4000-8000-000000000000");
  expect(missing.status()).toBe(404);
});
