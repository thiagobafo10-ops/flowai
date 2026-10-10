import { describe, expect, it } from "vitest";
import { contactDisplayName, contactSchema } from "./contact.ts";

const base = { name: "Ana", phone: "", email: "", status: "lead", assignedTo: "", tagIds: [], leadScore: 0, customFields: [] };
const msg = (v: unknown) => contactSchema.safeParse(v).error?.issues[0]?.message;

describe("contactSchema", () => {
  it("requires name, phone or email", () => {
    expect(msg({ ...base, name: "  " })).toBe("Informe ao menos nome, telefone ou e-mail.");
    expect(msg({})).toBe("Informe ao menos nome, telefone ou e-mail.");
  });
  it("trims and nulls empties, normalizes phone and email", () => {
    const c = contactSchema.parse({ ...base, name: "  ", phone: "11 99999-8888", email: " Ana@X.COM " });
    expect(c.name).toBeNull();
    expect(c.phone).toBe("+5511999998888");
    expect(c.email).toBe("ana@x.com");
    expect(c.assignedTo).toBeNull();
    expect(c.status).toBe("lead");
  });
  it("validates fields", () => {
    expect(msg({ ...base, name: "a".repeat(121) })).toBe("O nome deve ter no máximo 120 caracteres.");
    expect(msg({ ...base, email: "x" })).toBe("Informe um e-mail válido.");
    expect(msg({ ...base, phone: "123" })).toBe("Informe um telefone brasileiro válido.");
    expect(msg({ ...base, leadScore: 101 })).toBe("O lead score deve estar entre 0 e 100.");
    expect(msg({ ...base, leadScore: 1.5 })).toBe("O lead score deve estar entre 0 e 100.");
    expect(msg({ ...base, leadScore: -1 })).toBe("O lead score deve estar entre 0 e 100.");
    expect(contactSchema.parse({ ...base, leadScore: "40" }).leadScore).toBe(40);
  });
  it("validates custom fields", () => {
    expect(
      msg({ ...base, customFields: [{ key: "Cidade", value: "SP" }, { key: " cidade ", value: "RJ" }] }),
    ).toBe("Nomes de campos repetidos.");
    expect(msg({ ...base, customFields: [{ key: "", value: "x" }] })).toBeDefined();
    expect(msg({ ...base, customFields: [{ key: "k", value: "x".repeat(501) }] })).toBeDefined();
    expect(contactSchema.parse({ ...base, customFields: [{ key: " a ", value: "" }] }).customFields).toEqual([
      { key: "a", value: "" },
    ]);
  });
  it("rejects bad status and tag ids", () => {
    expect(msg({ ...base, status: "x" })).toBeDefined();
    expect(msg({ ...base, tagIds: ["nope"] })).toBeDefined();
  });
});

describe("contactDisplayName", () => {
  it("falls back in order", () => {
    expect(contactDisplayName({ name: "Ana", phone: "+5511999998888", email: "a@b.c" })).toBe("Ana");
    expect(contactDisplayName({ name: null, phone: "+5511999998888", email: null })).toBe("(11) 99999-8888");
    expect(contactDisplayName({ name: null, phone: null, email: "a@b.c" })).toBe("a@b.c");
    expect(contactDisplayName({ name: null, phone: null, email: null })).toBe("Sem nome");
  });
});
