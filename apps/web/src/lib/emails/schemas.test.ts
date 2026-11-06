import { describe, expect, it } from "vitest";
import { cancelReasonLabel, fromMinutes, stepSchema, toMinutes } from "./schemas";

const valid = { delayMinutes: 60, enabled: true, subject: "Oi", heading: "", body: "Texto", buttonLabel: "Comprar", coupon: "" };
const firstError = (input: unknown) => {
  const r = stepSchema.safeParse(input);
  return r.success ? null : r.error.issues[0].message;
};

describe("stepSchema", () => {
  it("accepts a valid step", () => expect(stepSchema.safeParse(valid).success).toBe(true));
  it("rejects an empty subject", () => expect(firstError({ ...valid, subject: "  " })).toBe("Informe o assunto."));
  it("rejects a body over 3000 characters", () =>
    expect(firstError({ ...valid, body: "a".repeat(3001) })).toBe("O texto deve ter no máximo 3000 caracteres."));
  it.each([-1, 43201])("rejects a delay of %i minutes", (delayMinutes) =>
    expect(firstError({ ...valid, delayMinutes })).toBe("A espera deve ser de 0 a 30 dias."));
  it("accepts an immediate step", () => expect(stepSchema.safeParse({ ...valid, delayMinutes: 0 }).success).toBe(true));
});

describe("delay conversion", () => {
  it("converts 2h to 120 minutes and back", () => {
    expect(toMinutes(2, "h")).toBe(120);
    expect(fromMinutes(120)).toEqual({ value: 2, unit: "h" });
  });
  it("uses days when exact and minutes otherwise", () => {
    expect(fromMinutes(2880)).toEqual({ value: 2, unit: "d" });
    expect(fromMinutes(90)).toEqual({ value: 90, unit: "min" });
    expect(toMinutes(3, "d")).toBe(4320);
  });
  it("shows zero minutes as an immediate delay, not zero days", () => {
    expect(fromMinutes(0)).toEqual({ value: 0, unit: "min" });
  });
});

describe("cancelReasonLabel", () => {
  it("translates known reasons and falls back for unknown ones", () => {
    expect(cancelReasonLabel("paid")).toBe("Pagou antes");
    expect(cancelReasonLabel("no_coupon")).toBe("Cupom não preenchido");
    expect(cancelReasonLabel("no_link")).toBe("Sem link do pedido");
    expect(cancelReasonLabel("whatever")).toBe("Outro motivo");
  });
});
