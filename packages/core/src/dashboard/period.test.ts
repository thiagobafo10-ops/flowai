import { describe, expect, it } from "vitest";
import { PERIOD_OPTIONS, parsePeriod, periodLabel, periodToDays } from "./period.ts";

describe("period", () => {
  it("parses", () => {
    expect(parsePeriod("30d")).toBe("30d");
    expect(parsePeriod("xx")).toBe("7d");
    expect(parsePeriod(undefined)).toBe("7d");
    expect(parsePeriod(null)).toBe("7d");
    expect(parsePeriod(["hoje"])).toBe("hoje");
  });
  it("maps days and labels", () => {
    expect(periodToDays("hoje")).toBe(1);
    expect(periodToDays("7d")).toBe(7);
    expect(periodToDays("30d")).toBe(30);
    expect(periodLabel("hoje")).toBe("hoje");
    expect(periodLabel("7d")).toBe("últimos 7 dias");
    expect(periodLabel("30d")).toBe("últimos 30 dias");
  });
  it("exposes options", () => {
    expect(PERIOD_OPTIONS.map((o) => o.label)).toEqual(["Hoje", "7 dias", "30 dias"]);
  });
});
