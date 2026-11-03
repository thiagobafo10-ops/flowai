import { describe, expect, it } from "vitest";
import { DEFAULT_CART_STEPS, fillVariables, renderEmail, type EmailContent, type EmailContext } from "./template.ts";

const item = (n: number) => ({ name: `Produto ${n}`, variant: null, quantity: 1, price: 10, imageUrl: null });
const ctx: EmailContext = {
  storeName: "Holy Spirit", firstName: "Ana", name: "Ana Souza", total: 89.9,
  items: [item(1)], buttonUrl: "https://loja.test/carrinho?a=1&b=2", unsubscribeUrl: null,
};
const content: EmailContent = { subject: "Oi", heading: "Título", body: "Corpo", buttonLabel: "Finalizar", coupon: null };

describe("email template", () => {
  it("fills variables", () => {
    expect(fillVariables("Oi, {primeiro_nome}! Cupom {cupom} na {loja}. Total {valor}", { ...ctx, coupon: "CUPOM20" }))
      .toBe("Oi, Ana! Cupom CUPOM20 na Holy Spirit. Total R$ 89,90");
  });
  it("missing variable is empty", () => {
    const c = { ...ctx, firstName: null, coupon: null };
    expect(fillVariables("Oi, {primeiro_nome}!", c)).toBe("Oi!");
    expect(fillVariables("{primeiro_nome}, volte", c)).toBe("Volte");
    expect(fillVariables("{xyz}", c)).toBe("{xyz}");
  });
  it("escapes", () => {
    const { html } = renderEmail({ ...content, heading: "<script>x</script> & cia" }, ctx);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; cia");
    expect(html).not.toContain("<script>");
  });
  it("items cap", () => {
    const { html } = renderEmail(content, { ...ctx, items: [1, 2, 3, 4, 5, 6].map(item) });
    for (const n of [1, 2, 3, 4]) expect(html).toContain(`Produto ${n}`);
    expect(html).not.toContain("Produto 5");
    expect(html).toContain("e mais 2 itens");
  });
  it("renders variant and image when present", () => {
    const { html } = renderEmail(content, { ...ctx, items: [{ ...item(1), variant: "Azul", imageUrl: "https://x.test/a.png" }] });
    expect(html).toContain("Azul");
    expect(html).toContain('<img src="https://x.test/a.png" alt="Produto 1"');
  });
  it("coupon box only with coupon", () => {
    expect(renderEmail(content, ctx).html).not.toContain("Seu cupom");
    const { html } = renderEmail({ ...content, coupon: "CUPOM20" }, ctx);
    expect(html).toContain("Seu cupom");
    expect(html).toContain("CUPOM20");
  });
  it("unsubscribe footer", () => {
    const url = "https://x.test/u?t=1";
    expect(renderEmail(content, { ...ctx, unsubscribeUrl: url }).html).toContain(url);
    expect(renderEmail(content, ctx).html).not.toContain("Não quero mais");
  });
  it("text version", () => {
    const { text } = renderEmail({ ...content, coupon: "CUPOM20" }, ctx);
    for (const s of ["Título", "Corpo", ctx.buttonUrl, "CUPOM20"]) expect(text).toContain(s);
  });
  it("default cart steps", () => {
    expect(DEFAULT_CART_STEPS.map((s) => s.delayMinutes)).toEqual([60, 1440, 2880]);
    expect(DEFAULT_CART_STEPS[2]!.coupon).toBe("");
  });
});
