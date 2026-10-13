import { describe, expect, it } from "vitest";
import { matchKeyword, normalizeText, renderTemplate } from "./text.ts";

describe("matchKeyword", () => {
  it("contains ignora maiúsculas, acentos e pontuação adjacente", () => {
    expect(matchKeyword("Quero a PROMOÇÃO!", ["promocao"], "contains")).toBe(true);
    expect(matchKeyword("Quero um desconto", ["promocao"], "contains")).toBe(false);
  });
  it("equals ignora espaços nas pontas", () => {
    expect(matchKeyword("  Promoção ", ["promocao"], "equals")).toBe(true);
    expect(matchKeyword("promoção já", ["promocao"], "equals")).toBe(false);
  });
  it("starts_with", () => {
    expect(matchKeyword("Cupom 10", ["cupom"], "starts_with")).toBe(true);
    expect(matchKeyword("Tenho cupom", ["cupom"], "starts_with")).toBe(false);
  });
  it("texto vazio é falso", () => {
    expect(matchKeyword("", ["a"], "contains")).toBe(false);
    expect(matchKeyword("   ", ["a"], "contains")).toBe(false);
  });
  it("ignora palavras-chave vazias e aceita qualquer uma da lista", () => {
    expect(matchKeyword("oi", [""], "contains")).toBe(false);
    expect(matchKeyword("quero preço", ["x", "preco"], "contains")).toBe(true);
  });
});

describe("normalizeText", () => {
  it("NFD, minúsculas e espaços colapsados", () => {
    expect(normalizeText("  Ação   RÁPIDA ")).toBe("acao rapida");
  });
});

describe("renderTemplate", () => {
  it("primeiro nome", () => {
    expect(renderTemplate("Oi {primeiro_nome}, tudo bem?", { name: "Ana Souza" })).toBe("Oi Ana, tudo bem?");
  });
  it("nome vazio remove variável e espaço excedente", () => {
    expect(renderTemplate("Oi {primeiro_nome}, tudo bem?", { name: null })).toBe("Oi, tudo bem?");
    expect(renderTemplate("{primeiro_nome} olá", { name: "  " })).toBe("olá");
  });
  it("nome completo", () => {
    expect(renderTemplate("Olá {nome}!", { name: "Ana Souza" })).toBe("Olá Ana Souza!");
  });
});
