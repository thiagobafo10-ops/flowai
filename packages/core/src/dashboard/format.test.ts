import { describe, expect, it } from "vitest";
import { formatBRL, formatInteger, formatPercent } from "./format.ts";

describe("format", () => {
  it("formats integers", () => expect(formatInteger(1234)).toBe("1.234"));
  it("formats BRL", () => expect(formatBRL(1000)).toBe("R$ 1.000,00"));
  it("formats more", () => {
    expect(formatPercent(0.3333)).toBe("33,3%");
    expect(formatBRL(1234.5)).toBe("R$ 1.234,50");
  });
  it("formats percent", () => {
    expect(formatPercent(0.375)).toBe("37,5%");
    expect(formatPercent(0)).toBe("0,0%");
    expect(formatPercent(null)).toBe("—");
  });
});
