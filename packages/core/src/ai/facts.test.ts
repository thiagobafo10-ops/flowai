import { describe, expect, it } from "vitest";
import { extractFacts, verifyFacts } from "./facts.ts";

describe("verifyFacts", () => {
  it("matches money across formats", () => {
    expect(verifyFacts("Custa R$ 1.299,90", ["Preço: 1299,90 reais"]).ok).toBe(true);
    expect(verifyFacts("Custa R$1299.90", ["R$ 1.299,90"]).ok).toBe(true);
  });
  it("flags a different price", () => {
    expect(verifyFacts("Custa R$ 1.199,90", ["R$ 1.299,90"])).toEqual({ ok: false, unverified: ["R$ 1.199,90"] });
  });
  it("percent needs numeric form in the source", () => {
    expect(verifyFacts("10% de desconto", ["dez por cento"]).ok).toBe(false);
    expect(verifyFacts("10% de desconto", ["desconto de 10 %"]).ok).toBe(true);
  });
  it("durations", () => {
    expect(verifyFacts("entrega em 3 dias úteis", ["prazo de 3 dias"]).ok).toBe(true);
    expect(verifyFacts("entrega em 3 dias úteis", ["prazo de 5 dias"]).ok).toBe(false);
    expect(verifyFacts("chega em 48h", ["48 horas"]).ok).toBe(true);
  });
  it("dates compare day/month", () => {
    expect(verifyFacts("até 15/11", ["15/11/2026"]).ok).toBe(true);
  });
  it("quantities", () => {
    expect(verifyFacts("temos 4 unidades", ["estoque: 3 unidades"]).ok).toBe(false);
  });
  it("no numbers is ok", () => {
    expect(verifyFacts("Olá! Como posso ajudar?", [])).toEqual({ ok: true, unverified: [] });
  });
  it("bare numbers are not facts", () => {
    expect(extractFacts("Somos 2 sócios")).toEqual([]);
    expect(verifyFacts("Somos 2 sócios", []).ok).toBe(true);
  });
  it("extracts canonical values", () => {
    expect(extractFacts("R$ 1.299,90")[0]).toMatchObject({ kind: "money", value: "1299.9" });
  });

  describe("fail-closed coverage", () => {
    it("percent spelled 'por cento'", () => {
      expect(verifyFacts("10 por cento de desconto", ["desconto de 10%"]).ok).toBe(true);
      expect(verifyFacts("15 por cento de desconto", ["desconto de 10%"]).ok).toBe(false);
    });
    it("mil / reais / dollars", () => {
      expect(verifyFacts("custa 5 mil reais", ["R$ 5.000,00"]).ok).toBe(true);
      expect(verifyFacts("custa 5 mil reais", ["R$ 4.000"]).ok).toBe(false);
      expect(extractFacts("R$ 2 mil")[0]).toMatchObject({ value: "2000" });
      expect(verifyFacts("custa 1 real", ["R$ 2"]).ok).toBe(false);
      expect(verifyFacts("US$ 50", ["50 dólares"]).ok).toBe(true);
      expect(verifyFacts("US$ 50", ["R$ 50"]).ok).toBe(false);
    });
    it("installments", () => {
      expect(verifyFacts("12x sem juros", ["10x"]).ok).toBe(false);
      expect(verifyFacts("12x sem juros", ["em até 12 parcelas"]).ok).toBe(true);
      expect(verifyFacts("10 x sem juros", []).unverified).toEqual(["10 x"]);
    });
    it("years, hrs and named dates", () => {
      expect(verifyFacts("garantia de 2 anos", ["garantia de 1 ano"]).ok).toBe(false);
      expect(verifyFacts("garantia de 2 anos", ["garantia de 2 anos"]).ok).toBe(true);
      expect(verifyFacts("24hrs", ["24 horas"]).ok).toBe(true);
      expect(verifyFacts("15 de novembro", ["15/11/2026"]).ok).toBe(true);
      expect(verifyFacts("15 de novembro", ["16/11"]).ok).toBe(false);
    });
    it("day-only dates", () => {
      expect(verifyFacts("vence dia 20", ["dia 25"]).ok).toBe(false);
      expect(verifyFacts("vence dia 20", ["dia 20"]).ok).toBe(true);
    });
    it("ranges check both bounds", () => {
      expect(verifyFacts("de 2 a 3 dias", ["3 dias"]).ok).toBe(false);
      expect(verifyFacts("3-5 dias", ["3 dias", "5 dias"]).ok).toBe(true);
      expect(verifyFacts("3-5 dias", ["3 dias"]).ok).toBe(false);
    });
    it("number words with units fail closed unless same text in a source", () => {
      expect(verifyFacts("cem reais", []).unverified).toEqual(["cem reais"]);
      expect(verifyFacts("em dez dias", []).ok).toBe(false);
      expect(verifyFacts("em dez dias", ["prazo de dez dias"]).ok).toBe(true);
      expect(verifyFacts("5 mil reais", ["5 mil reais"]).ok).toBe(true);
    });
  });
});
