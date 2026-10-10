import { describe, expect, it } from "vitest";
import { CONTACTS_PAGE_SIZE, parseContactFilters } from "./filters.ts";

const U = "123e4567-e89b-42d3-a456-426614174000";

describe("parseContactFilters", () => {
  it("defaults on invalid values", () => {
    expect(parseContactFilters({ ordem: "x", pagina: "-2", tag: "nao-uuid" })).toMatchObject({
      order: "interacao",
      page: 1,
      tagId: null,
    });
    expect(parseContactFilters({})).toEqual({
      q: "", status: null, tagId: null, assignee: null, source: null, order: "interacao", page: 1,
    });
    expect(CONTACTS_PAGE_SIZE).toBe(25);
  });
  it("parses valid values", () => {
    expect(
      parseContactFilters({ q: "  ana ", status: "customer", tag: U, responsavel: U, origem: "instagram", ordem: "score", pagina: "3" }),
    ).toEqual({ q: "ana", status: "customer", tagId: U, assignee: U, source: "instagram", order: "score", page: 3 });
    expect(parseContactFilters({ responsavel: "nenhum" }).assignee).toBe("nenhum");
  });
  it("handles arrays, truncation and bad numbers", () => {
    expect(parseContactFilters({ q: ["a", "b"] }).q).toBe("a");
    expect(parseContactFilters({ q: "x".repeat(150) }).q).toHaveLength(100);
    expect(parseContactFilters({ pagina: "1.5" }).page).toBe(1);
    expect(parseContactFilters({ pagina: "abc" }).page).toBe(1);
    expect(parseContactFilters({ status: "zzz", origem: "zzz", responsavel: "zzz" })).toMatchObject({
      status: null, source: null, assignee: null,
    });
  });
});
