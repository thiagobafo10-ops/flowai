import { describe, expect, it } from "vitest";
import { dealSchema, defaultDealTitle, stageNameSchema } from "./deal.ts";

const U = "123e4567-e89b-42d3-a456-426614174000";
const d = { contactId: U, title: " Venda ", value: 0, ownerId: "", stageId: U };

describe("dealSchema", () => {
  it("parses values", () => {
    expect(dealSchema.parse({ ...d, value: "1.234,56" }).value).toBe(1234.56);
    expect(dealSchema.parse({ ...d, value: "1234.56" }).value).toBe(1234.56);
    expect(dealSchema.parse({ ...d, value: "1234,5" }).value).toBe(1234.5);
    expect(dealSchema.parse({ ...d, value: 10.456 }).value).toBe(10.46);
    expect(dealSchema.parse({ ...d, value: "" }).value).toBe(0);
    const p = dealSchema.parse(d);
    expect(p.title).toBe("Venda");
    expect(p.ownerId).toBeNull();
  });
  it("rejects invalid", () => {
    expect(dealSchema.safeParse({ ...d, value: -1 }).success).toBe(false);
    expect(dealSchema.safeParse({ ...d, value: "abc" }).success).toBe(false);
    expect(dealSchema.safeParse({ ...d, value: "1e3" }).success).toBe(false);
    expect(dealSchema.safeParse({ ...d, title: " " }).success).toBe(false);
    expect(dealSchema.safeParse({ ...d, title: "a".repeat(121) }).success).toBe(false);
    expect(dealSchema.safeParse({ ...d, contactId: "x" }).success).toBe(false);
    expect(dealSchema.safeParse({ ...d, stageId: "x" }).success).toBe(false);
  });
  it("builds default title", () => {
    expect(defaultDealTitle("Ana")).toBe("Oportunidade — Ana");
  });
});

describe("stageNameSchema", () => {
  it("validates 1-40 trimmed", () => {
    expect(stageNameSchema.parse("  Nova ")).toBe("Nova");
    const m = (v: string) => stageNameSchema.safeParse(v).error?.issues[0]?.message;
    expect(m(" ")).toBe("O nome da etapa deve ter entre 1 e 40 caracteres.");
    expect(m("a".repeat(41))).toBe("O nome da etapa deve ter entre 1 e 40 caracteres.");
  });
});
