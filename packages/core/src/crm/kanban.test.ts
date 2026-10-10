import { describe, expect, it } from "vitest";
import { columnTotals, matchesDealQuery, parseKanbanFilters } from "./kanban.ts";

const U = "123e4567-e89b-42d3-a456-426614174000";

describe("parseKanbanFilters", () => {
  it("defaults", () => {
    expect(parseKanbanFilters({})).toEqual({ q: "", ownerId: null, closed: "30d" });
  });
  it("parses", () => {
    expect(parseKanbanFilters({ q: " x ", responsavel: U, encerrados: "todos" })).toEqual({ q: "x", ownerId: U, closed: "todos" });
    expect(parseKanbanFilters({ responsavel: "no", encerrados: "zz" })).toEqual({ q: "", ownerId: null, closed: "30d" });
  });
});

describe("columnTotals", () => {
  it("sums per stage", () => {
    expect(columnTotals([{ stageId: "a", value: 10 }, { stageId: "a", value: 5.5 }])).toEqual({ a: { count: 2, value: 15.5 } });
    expect(columnTotals([])).toEqual({});
    expect(columnTotals([{ stageId: "a", value: 0.1 }, { stageId: "a", value: 0.2 }]).a?.value).toBe(0.3);
  });
});

describe("matchesDealQuery", () => {
  const deal = { contactName: "João Silva", phone: "+5511988887777", email: "joao@ex.com", title: "Contrato anual" };
  it("matches name, title and email without accents", () => {
    expect(matchesDealQuery("", deal)).toBe(true);
    expect(matchesDealQuery("joao", deal)).toBe(true);
    expect(matchesDealQuery("CONTRATO", deal)).toBe(true);
    expect(matchesDealQuery("ex.com", deal)).toBe(true);
    expect(matchesDealQuery("maria", deal)).toBe(false);
  });
  it("matches phone digits when the query has 3+ digits", () => {
    expect(matchesDealQuery("8888-7777", deal)).toBe(true);
    expect(matchesDealQuery("(11) 98888 7777", deal)).toBe(true);
    expect(matchesDealQuery("1234-5678", deal)).toBe(false);
    // Menos de 3 dígitos: não vira busca por telefone.
    expect(matchesDealQuery("7-7", deal)).toBe(false);
    expect(matchesDealQuery("8888", { ...deal, phone: null })).toBe(false);
  });
});
