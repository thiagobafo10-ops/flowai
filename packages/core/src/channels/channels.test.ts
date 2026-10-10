import { describe, expect, it } from "vitest";
import { providerFor, replySchema, SimulatorProvider, simulatorInboundSchema } from "./index.ts";

describe("replySchema", () => {
  it("validates text", () => {
    expect(replySchema.safeParse({ text: "   " }).error?.issues[0]?.message).toBe("Escreva uma mensagem.");
    expect(replySchema.safeParse({ text: "a".repeat(4096) }).success).toBe(true);
    expect(replySchema.safeParse({ text: "a".repeat(4097) }).error?.issues[0]?.message).toBe(
      "A mensagem deve ter no máximo 4096 caracteres.",
    );
    expect(replySchema.parse({ text: "  oi " })).toEqual({ text: "oi" });
  });
});

describe("simulatorInboundSchema", () => {
  it("rejects invalid phone", () => {
    expect(simulatorInboundSchema.safeParse({ name: null, phone: "123", text: "x" }).error?.issues[0]?.message).toBe(
      "Informe um telefone brasileiro válido.",
    );
  });
});

describe("SimulatorProvider", () => {
  it("converts raw input", async () => {
    const p = new SimulatorProvider();
    const [m] = p.receiveMessage({ name: "Ana", phone: "(11) 99999-8888", text: "Oi" });
    expect(m!.senderExternalId).toBe("+5511999998888");
    expect(m!.externalId).toMatch(/^sim_[0-9a-f-]{36}$/);
    expect(m!.senderName).toBe("Ana");
    expect((await p.sendMessage({ externalId: "x" }, { text: "a" })).externalId).toMatch(/^sim_/);
    await expect(p.markAsRead("x")).resolves.toBeUndefined();
    expect(await p.getContact("x")).toEqual({ name: null });
  });
  it("throws on invalid input", () => {
    expect(() => new SimulatorProvider().receiveMessage({ name: "A", phone: "1", text: "x" })).toThrow();
  });
});

describe("providerFor", () => {
  it("resolves", () => {
    expect(providerFor("simulator")).toBeInstanceOf(SimulatorProvider);
    expect(() => providerFor("whatsapp")).toThrow("Canal ainda não disponível.");
    expect(() => providerFor("instagram")).toThrow("Canal ainda não disponível.");
  });
});
