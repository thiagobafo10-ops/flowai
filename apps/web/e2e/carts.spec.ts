import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { newEmail, signUpWithOrg } from "./support/auth";
import { gotoReady } from "./support/nav";
import { clearRateLimits, psql } from "./support/local-db";
import { orgFor } from "./support/automation";

// Homologação isolada: Supabase local, dados sintéticos, nenhuma chamada externa.
// O setup chama public.ingest_yampi_event pelo psql do banco local (mesma função do webhook).
test.setTimeout(120_000);
test.beforeEach(() => clearRateLimits());

const HOST = "loja.exemplo.test";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function setup(page: Page) {
  const email = newEmail();
  await signUpWithOrg(page, email, "Carrinhos E2E");
  const org = orgFor(email);
  const conn = psql(`insert into public.store_connections(organization_id,merchant_alias,webhook_secret_id,checkout_hosts)
    values ('${org}','loja-e2e','${randomUUID()}','{${HOST}}') returning id`).split("\n")[0];
  return { org, conn };
}

function cart(conn: string, ext: string, customer: string) {
  const event = {
    kind: "cart", event: "cart.reminder", merchantAlias: "loja-e2e",
    customer: { email: `${ext}@cliente.test`, name: customer, phone: "+5511987654321" },
    cart: { externalId: ext, token: `tok-${ext}`, total: 99.9, recoveryUrl: `https://${HOST}/r/${ext}`,
      abandonedAt: new Date().toISOString(), items: [{ name: "Terço", quantity: 1, price: 99.9 }] },
  };
  psql(`select public.ingest_yampi_event('${conn}', ${q(JSON.stringify(event))}::jsonb, 'h-${ext}')`);
  return psql(`select id from public.store_carts where connection_id='${conn}' and external_id='${ext}'`);
}

async function grant(page: Page) {
  await page.getByRole("button", { name: "Autorização de contato", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Autorizado").check();
  await dialog.getByLabel("Origem").fill("pediu contato pelo Instagram");
  await dialog.getByLabel("Data da evidência").fill("2026-01-15T10:00");
  await dialog.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText("Autorização registrada.").first()).toBeVisible();
}

test("Carrinhos: envio manual pelo WhatsApp, histórico e repetição", async ({ page }) => {
  const { conn } = await setup(page);
  const id = cart(conn, "c-envio", "Maria");
  await gotoReady(page, `/carrinhos/${id}`);
  await expect(page.getByText("Sem autorização de contato registrada.")).toBeVisible();
  await grant(page);

  await page.getByRole("button", { name: "Preparar mensagem" }).click();
  const message = page.getByLabel("Mensagem", { exact: true });
  await message.fill(`Oi Maria, seu carrinho segue aberto: https://${HOST}/r/c-envio`);
  const wa = page.getByRole("link", { name: "Abrir WhatsApp" });
  await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\//); // nunca clicar
  await page.getByRole("button", { name: "Confirmar que enviei" }).click();
  await expect(page.getByText("Envio registrado.").first()).toBeVisible();
  await expect(page.getByText("WhatsApp aberto (não conta como envio)")).toBeVisible();
  await expect(page.getByText("Envio confirmado pelo operador")).toBeVisible();

  // segundo envio pede confirmação de repetição
  await page.getByRole("button", { name: "Preparar mensagem" }).click();
  await page.getByRole("button", { name: "Confirmar que enviei" }).click();
  await expect(page.getByText("Já houve envio para este carrinho. Registrar outro envio?")).toBeVisible();
  await page.getByRole("button", { name: "Registrar outro envio" }).click();
  await expect(page.getByText("Envio confirmado pelo operador")).toHaveCount(2);
  expect(Number(psql(`select count(*) from public.cart_contact_actions where cart_id='${id}' and action='marked_sent'`))).toBe(2);
});

test("Carrinhos: sem autorização bloqueia e registrar autorização libera", async ({ page }) => {
  const { conn } = await setup(page);
  const id = cart(conn, "c-semaut", "João");
  await gotoReady(page, `/carrinhos/${id}`);
  await expect(page.getByText("Contato indisponível: Sem autorização de contato registrada")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preparar mensagem" })).toBeDisabled();
  await grant(page);
  await expect(page.getByText("Nenhum. Elegível para contato pelo WhatsApp.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preparar mensagem" })).toBeEnabled();
});

test("Carrinhos: carrinho pago mostra Pagamento confirmado sem ações de WhatsApp", async ({ page }) => {
  const { conn } = await setup(page);
  const id = cart(conn, "c-pago", "Ana");
  const order = {
    kind: "order", event: "order.paid", merchantAlias: "loja-e2e",
    customer: { email: "c-pago@cliente.test", name: "Ana", phone: null },
    order: { externalId: "o-pago", number: "N1", statusAlias: "paid", paymentAlias: "pix", total: 99.9,
      cartToken: "tok-c-pago", paid: true, items: [], trackCode: null, trackUrl: null },
  };
  psql(`select public.ingest_yampi_event('${conn}', ${q(JSON.stringify(order))}::jsonb, 'h-o-pago')`);
  await gotoReady(page, `/carrinhos/${id}`);
  await expect(page.getByText("Contato indisponível: Pagamento confirmado")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preparar mensagem" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Abrir WhatsApp" })).toHaveCount(0);
});
