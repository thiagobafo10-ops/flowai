import { describe, it, expect } from "vitest";
import { signUpSchema, signInSchema, createOrganizationSchema } from "./auth.ts";

describe("signUpSchema", () => {
  it("aceita dados válidos e normaliza e-mail", () => {
    const r = signUpSchema.parse({ fullName: "  Ana Souza ", email: " ANA@Exemplo.com ", password: "12345678" });
    expect(r).toEqual({ fullName: "Ana Souza", email: "ana@exemplo.com", password: "12345678" });
  });
  it("rejeita senha com menos de 8 caracteres com mensagem em pt-BR", () => {
    const r = signUpSchema.safeParse({ fullName: "Ana", email: "a@b.com", password: "1234567" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("A senha deve ter pelo menos 8 caracteres.");
  });
  it("rejeita nome com menos de 2 caracteres", () => {
    expect(signUpSchema.safeParse({ fullName: " a ", email: "a@b.com", password: "12345678" }).success).toBe(false);
  });
  it("nome curto tem mensagem em pt-BR", () => {
    const r = signUpSchema.safeParse({ fullName: " a ", email: "a@b.com", password: "12345678" });
    expect(r.error?.issues[0]?.message).toBe("Informe seu nome completo.");
  });
  it("aceita nome com 100 caracteres e rejeita 101 com mensagem em pt-BR", () => {
    expect(signUpSchema.safeParse({ fullName: "a".repeat(100), email: "a@b.com", password: "12345678" }).success).toBe(true);
    const r = signUpSchema.safeParse({ fullName: "a".repeat(101), email: "a@b.com", password: "12345678" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("O nome deve ter no máximo 100 caracteres.");
  });
  it("aceita senha com 72 caracteres e rejeita 73 com mensagem em pt-BR", () => {
    expect(signUpSchema.safeParse({ fullName: "Ana", email: "a@b.com", password: "x".repeat(72) }).success).toBe(true);
    const r = signUpSchema.safeParse({ fullName: "Ana", email: "a@b.com", password: "x".repeat(73) });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("A senha deve ter no máximo 72 caracteres.");
  });
  it("rejeita e-mail inválido", () => {
    const r = signUpSchema.safeParse({ fullName: "Ana", email: "ana", password: "12345678" });
    expect(r.error?.issues[0]?.message).toBe("Informe um e-mail válido.");
  });
});

describe("signInSchema", () => {
  it("exige senha não vazia", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("createOrganizationSchema", () => {
  it("apara o nome e preserva acentos e símbolos", () => {
    expect(createOrganizationSchema.parse({ name: "  Açaí & Cia!!  " })).toEqual({ name: "Açaí & Cia!!" });
  });
  it("rejeita nome vazio após trim", () => {
    const r = createOrganizationSchema.safeParse({ name: "    " });
    expect(r.error?.issues[0]?.message).toBe("Informe o nome da empresa.");
  });
  it("rejeita nome com mais de 80 caracteres", () => {
    expect(createOrganizationSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
});
