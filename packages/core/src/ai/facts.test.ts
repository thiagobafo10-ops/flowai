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
});
