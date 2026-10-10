import { describe, expect, it } from "vitest";
import { columnTotals, parseKanbanFilters } from "./kanban.ts";

const U = "123e4567-e89b-42d3-a456-426614174000";

describe("parseKanbanFilters", () => {
  it("defaults", () => {
    expect(parseKanbanFilters({})).toEqual({ q: "", ownerId: null, closed: "30d" });
  });
  it("parses", () => {
    expect(parseKanbanFilters({ q: " x ", responsavel: U, fechados: "todos" })).toEqual({ q: "x", ownerId: U, closed: "todos" });
    expect(parseKanbanFilters({ responsavel: "no", fechados: "zz" })).toEqual({ q: "", ownerId: null, closed: "30d" });
  });
});

describe("columnTotals", () => {
  it("sums per stage", () => {
    expect(columnTotals([{ stageId: "a", value: 10 }, { stageId: "a", value: 5.5 }])).toEqual({ a: { count: 2, value: 15.5 } });
    expect(columnTotals([])).toEqual({});
    expect(columnTotals([{ stageId: "a", value: 0.1 }, { stageId: "a", value: 0.2 }]).a?.value).toBe(0.3);
  });
});
