import { describe, expect, it } from "vitest";
import cart from "./fixtures/yampi-cart-reminder.json";
import order from "./fixtures/yampi-order-paid.json";
import { parseYampiEvent, verifyYampiSignature } from "./yampi.ts";

const clone = <T,>(v: T): any => JSON.parse(JSON.stringify(v));

describe("parseYampiEvent", () => {
  it("parses cart.reminder", () => {
    const e = parseYampiEvent(cart);
    expect(e.kind).toBe("cart");
    if (e.kind !== "cart") return;
    expect(e.merchantAlias).toBe("loja-exemplo");
    expect(e.cart.externalId).toBe("98765");
    expect(e.cart.recoveryUrl).toBe("https://seguro.loja-exemplo.com.br/r/ABC123");
    expect(e.cart.total).toBe(189.8);
    expect(e.customer.email).toBe("maria.silva@example.com");
    expect(e.cart.items[0]).toEqual({ name: "Camiseta Exemplo", variant: null, quantity: 2, price: 94.9, imageUrl: null });
  });

  it("parses order.paid", () => {
    const e = parseYampiEvent({ ...clone(order), event: "order.paid" });
    expect(e.kind).toBe("order");
    if (e.kind !== "order") return;
    expect(e.order).toMatchObject({ externalId: "55501", number: "10234", paid: true, paymentAlias: "pix", cartToken: "TOKENCARRINHO123", statusAlias: "paid", total: 189.8 });
  });

  it("ignores unknown events", () => {
    expect(parseYampiEvent({ event: "product.updated", resource: {} })).toEqual({ kind: "ignored", event: "product.updated" });
  });

  it("invalid email becomes null", () => {
    const raw = clone(cart);
    raw.resource.customer.data.email = "sem-arroba";
    const e = parseYampiEvent(raw);
    if (e.kind === "ignored") throw new Error("unexpected");
    expect(e.customer.email).toBeNull();
  });

  it("rejects known event without resource.id", () => {
    const raw = clone(cart);
    delete raw.resource.id;
    expect(() => parseYampiEvent(raw)).toThrow();
  });
});

describe("verifyYampiSignature", () => {
  it("verifies signature over raw bytes", async () => {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode("s3cr3t"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode('{"a": 1}')));
    const header = btoa(String.fromCharCode(...mac));
    expect(await verifyYampiSignature(enc.encode('{"a": 1}'), header, "s3cr3t")).toBe(true);
    expect(await verifyYampiSignature(enc.encode('{"a":1}'), header, "s3cr3t")).toBe(false);
    expect(await verifyYampiSignature(enc.encode('{"a": 1}'), null, "s3cr3t")).toBe(false);
  });
});
