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
  it("equals não ignora pontuação e contains é por substring", () => {
    expect(matchKeyword("Promoção!", ["promocao"], "equals")).toBe(false);
    expect(matchKeyword("superpromocao", ["promocao"], "contains")).toBe(true);
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
  it("casos de variável vazia", () => {
    const r = (t: string, name: string | null = null) => renderTemplate(t, { name });
    expect(r("Oi{nome} tudo")).toBe("Oi tudo");
    expect(r("Oi\n{nome}\nTchau")).toBe("Oi\n\nTchau");
    expect(r("Oi, {primeiro_nome}!")).toBe("Oi!");
    expect(r("Olá {nome} e bem-vindo")).toBe("Olá e bem-vindo");
    expect(r("Oi {primeiro_nome} {nome} tudo")).toBe("Oi tudo");
    expect(r("Tchau {nome}")).toBe("Tchau");
    expect(r("  Oi {nome}  ")).toBe("  Oi  ");
  });
  it("variável preenchida em cada formato", () => {
    const r = (t: string) => renderTemplate(t, { name: "Ana Souza" });
    expect(r("Oi{nome} tudo")).toBe("OiAna Souza tudo");
    expect(r("Oi\n{primeiro_nome}\nTchau")).toBe("Oi\nAna\nTchau");
    expect(r("Oi, {primeiro_nome}!")).toBe("Oi, Ana!");
    expect(r("Olá {nome} e bem-vindo")).toBe("Olá Ana Souza e bem-vindo");
    expect(r("{primeiro_nome} {nome}")).toBe("Ana Ana Souza");
    expect(r("Tchau {nome}")).toBe("Tchau Ana Souza");
  });
  it("nome completo", () => {
    expect(renderTemplate("Olá {nome}!", { name: "Ana Souza" })).toBe("Olá Ana Souza!");
  });
});
