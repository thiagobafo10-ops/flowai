import { expect, test } from "vitest";
import { canReturnToAi, handoffBannerText, sentimentLabel } from "./ai-display";

test("sentiment codes map to Portuguese labels", () => {
  expect(sentimentLabel("positive")).toBe("Positivo");
  expect(sentimentLabel("neutral")).toBe("Neutro");
  expect(sentimentLabel("negative")).toBe("Negativo");
  expect(sentimentLabel("weird")).toBe("weird");
  expect(sentimentLabel(null)).toBeNull();
});
test("handoff banner uses the label, falls back to the raw code and hides without reason", () => {
  expect(handoffBannerText("needs_human")).toBe("Transferida pela IA: Cliente precisa de atendimento humano");
  expect(handoffBannerText("window_closed")).toBe("Transferida pela IA: Fora da janela de 24h do Instagram");
  expect(handoffBannerText("novo_codigo")).toBe("Transferida pela IA: novo_codigo");
  expect(handoffBannerText(null)).toBeNull();
});
test("automation handoff banner names the automation, not the AI", () => {
  expect(handoffBannerText("automation")).toBe("Automação transferiu para atendimento humano");
});
test("return-to-AI button visibility matrix", () => {
  for (const canWrite of [true, false]) for (const status of ["open", "pending_human", "closed"] as const) for (const handledBy of ["human", "ai"] as const) {
    expect(canReturnToAi({ canWrite, status, handledBy })).toBe(canWrite && status !== "closed" && handledBy === "human");
  }
});
