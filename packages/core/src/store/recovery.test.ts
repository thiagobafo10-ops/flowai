import { describe, expect, it } from "vitest";
import { DEFAULT_WHATSAPP_TEMPLATE, isAllowedCheckoutUrl, normalizeBrazilMobile, renderWhatsappMessage, whatsappUrl } from "./recovery.ts";

describe("normalizeBrazilMobile", () => {
  it.each([
    ["(11) 98765-4321", "+5511987654321"],
    ["+55 11 98765-4321", "+5511987654321"],
    ["5511987654321", "+5511987654321"],
    ["1134567890", null],
    ["98765-4321", null],
    ["(00) 98765-4321", null],
    [null, null],
  ])("%s -> %s", (raw, out) => expect(normalizeBrazilMobile(raw)).toBe(out));
});

describe("isAllowedCheckoutUrl", () => {
  const hosts = ["seguro.useholyspirit.store"];
  it("checks scheme and exact host", () => {
    expect(isAllowedCheckoutUrl("https://seguro.useholyspirit.store/cart?x=1", hosts)).toBe(true);
    expect(isAllowedCheckoutUrl("http://seguro.useholyspirit.store/cart", hosts)).toBe(false);
    expect(isAllowedCheckoutUrl("javascript:alert(1)", hosts)).toBe(false);
    expect(isAllowedCheckoutUrl("https://seguro.useholyspirit.store.evil.com/", hosts)).toBe(false);
    expect(isAllowedCheckoutUrl("https://seguro.useholyspirit.store/", [])).toBe(false);
    expect(isAllowedCheckoutUrl("nao e url", hosts)).toBe(false);
    expect(isAllowedCheckoutUrl(null, hosts)).toBe(false);
  });
});

describe("renderWhatsappMessage", () => {
  const v = { firstName: "Ana", link: "https://x", total: 89.9, storeName: "Holy Spirit", items: [{ name: "Camiseta Maria", quantity: 2 }, { name: "Terço", quantity: 1 }] };
  const t = "Oi, {primeiro_nome}! Seu carrinho na {loja} ({valor}): {link}";
  it("fills variables", () => expect(renderWhatsappMessage(t, v)).toBe("Oi, Ana! Seu carrinho na Holy Spirit (R$ 89,90): https://x"));
  it("drops orphan comma without name", () => expect(renderWhatsappMessage(t, { ...v, firstName: null })).toBe("Oi! Seu carrinho na Holy Spirit (R$ 89,90): https://x"));
  it("renders items", () => expect(renderWhatsappMessage("{itens}", v)).toBe("2x Camiseta Maria, 1x Terço"));
});

it("whatsappUrl encodes text", () => {
  expect(whatsappUrl("+5511987654321", "Oi & tchau")).toBe("https://api.whatsapp.com/send?phone=5511987654321&text=Oi%20%26%20tchau");
  // wa.me troca emojis fora do BMP por "�" ao redirecionar; o endereço direto preserva
  expect(whatsappUrl("+5511987654321", "🤍🛍️")).toBe("https://api.whatsapp.com/send?phone=5511987654321&text=%F0%9F%A4%8D%F0%9F%9B%8D%EF%B8%8F");
});

it("default template", () => {
  expect(DEFAULT_WHATSAPP_TEMPLATE).toContain("{primeiro_nome}");
  expect(DEFAULT_WHATSAPP_TEMPLATE).toContain("{loja}");
  expect(DEFAULT_WHATSAPP_TEMPLATE).toContain("{link}");
  expect(DEFAULT_WHATSAPP_TEMPLATE.length).toBeLessThanOrEqual(400);
});
