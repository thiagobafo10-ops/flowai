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
