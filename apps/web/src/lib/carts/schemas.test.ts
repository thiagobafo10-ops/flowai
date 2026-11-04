import { describe, expect, it } from "vitest";
import { cartsHref, parseCartFilters, toRpcFilters } from "./schemas";

describe("parseCartFilters", () => {
  it("usa padrões", () => {
    const f = parseCartFilters({});
    expect(f).toMatchObject({ q: "", period: "all", page: 1, pageSize: 25, eligible: null, error: null });
  });
  it("período custom sem datas dá erro", () => {
    expect(parseCartFilters({ periodo: "custom" }).error).toBe("Informe as datas.");
    expect(parseCartFilters({ periodo: "custom", de: "2026-10-01" }).error).toBe("Informe as datas.");
  });
  it("intervalo custom acima de 366 dias dá erro", () => {
    expect(parseCartFilters({ periodo: "custom", de: "2025-01-01", ate: "2026-01-02" }).error).toBe(
      "O período deve ter no máximo 366 dias.",
    );
    expect(parseCartFilters({ periodo: "custom", de: "2025-01-01", ate: "2026-01-01" }).error).toBeNull();
  });
  it("data final antes da inicial dá erro", () => {
    expect(parseCartFilters({ periodo: "custom", de: "2026-10-05", ate: "2026-10-01" }).error).toBe(
      "A data final deve ser depois da inicial.",
    );
  });
  it("limita page e pageSize a 1..100", () => {
    expect(parseCartFilters({ pagina: "0", limite: "0" })).toMatchObject({ page: 1, pageSize: 1 });
    expect(parseCartFilters({ pagina: "999", limite: "999" })).toMatchObject({ page: 100, pageSize: 100 });
    expect(parseCartFilters({ pagina: "abc", limite: "x" })).toMatchObject({ page: 1, pageSize: 25 });
  });
  it("ignora valores fora da lista", () => {
    const f = parseCartFilters({ comercial: "xx", estagio: "yy", elegivel: "talvez", periodo: "zz" });
    expect(f).toMatchObject({ commercialStatus: null, recoveryStage: null, eligible: null, period: "all" });
  });
  it("lê filtros válidos", () => {
    const f = parseCartFilters({ comercial: "paid", estagio: "new", elegivel: "sim", q: [" ana ", "b"] });
    expect(f).toMatchObject({ commercialStatus: "paid", recoveryStage: "new", eligible: true, q: "ana" });
  });
});

describe("toRpcFilters", () => {
  const now = new Date("2026-11-03T02:00:00Z"); // 2026-11-02 23:00 em São Paulo
  it("hoje começa à meia-noite de São Paulo", () => {
    expect(toRpcFilters(parseCartFilters({ periodo: "today" }), now).from).toBe("2026-11-02T03:00:00.000Z");
  });
  it("7d e 30d incluem o dia atual", () => {
    expect(toRpcFilters(parseCartFilters({ periodo: "7d" }), now).from).toBe("2026-10-27T03:00:00.000Z");
    expect(toRpcFilters(parseCartFilters({ periodo: "30d" }), now).from).toBe("2026-10-04T03:00:00.000Z");
  });
  it("custom: 'to' é o início do dia seguinte ao final", () => {
    const r = toRpcFilters(parseCartFilters({ periodo: "custom", de: "2026-10-01", ate: "2026-10-31" }), now);
    expect(r.from).toBe("2026-10-01T03:00:00.000Z");
    expect(r.to).toBe("2026-11-01T03:00:00.000Z");
  });
  it("telefone vira só dígitos; texto fica como está", () => {
    expect(toRpcFilters(parseCartFilters({ q: "(11) 98765-4321" }), now).q).toBe("11987654321");
    expect(toRpcFilters(parseCartFilters({ q: "ana@x.com" }), now).q).toBe("ana@x.com");
    expect(toRpcFilters(parseCartFilters({ q: "123" }), now).q).toBe("123");
  });
  it("omite filtros vazios e envia elegível", () => {
    expect(toRpcFilters(parseCartFilters({}), now)).toEqual({});
    expect(toRpcFilters(parseCartFilters({ elegivel: "nao" }), now)).toEqual({ eligible: false });
  });
});

describe("cartsHref", () => {
  it("omite padrões e preserva ajustes", () => {
    const f = parseCartFilters({ comercial: "paid", pagina: "3" });
    expect(cartsHref(f)).toBe("/carrinhos?comercial=paid&pagina=3");
    expect(cartsHref(f, { page: 1 })).toBe("/carrinhos?comercial=paid");
    expect(cartsHref(parseCartFilters({}))).toBe("/carrinhos");
  });
});
