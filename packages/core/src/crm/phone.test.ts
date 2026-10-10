import { describe, expect, it } from "vitest";
import { formatBrazilianPhone, normalizeBrazilianPhone } from "./phone.ts";

describe("normalizeBrazilianPhone", () => {
  it("normalizes common formats", () => {
    expect(normalizeBrazilianPhone("(11) 99999-8888")).toBe("+5511999998888");
    expect(normalizeBrazilianPhone("11999998888")).toBe("+5511999998888");
    expect(normalizeBrazilianPhone("+55 11 99999-8888")).toBe("+5511999998888");
    expect(normalizeBrazilianPhone("1199998888")).toBe("+551199998888");
    expect(normalizeBrazilianPhone("551199998888")).toBe("+551199998888");
  });
  it("rejects invalid input", () => {
    expect(normalizeBrazilianPhone("123")).toBeNull();
    expect(normalizeBrazilianPhone("")).toBeNull();
    expect(normalizeBrazilianPhone("0599998888")).toBeNull();
    expect(normalizeBrazilianPhone("10999998888")).toBeNull();
    expect(normalizeBrazilianPhone("+54 11 99999-8888")).toBeNull();
    expect(normalizeBrazilianPhone("5510999998888")).toBeNull();
  });
});

describe("formatBrazilianPhone", () => {
  it("formats mobile and landline", () => {
    expect(formatBrazilianPhone("+5511999998888")).toBe("(11) 99999-8888");
    expect(formatBrazilianPhone("+551199998888")).toBe("(11) 9999-8888");
  });
  it("returns unknown input unchanged", () => {
    expect(formatBrazilianPhone("abc")).toBe("abc");
  });
});
