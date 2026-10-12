import { expect, test } from "vitest";
import { isInstagramWindowOpen } from "./instagram-window";

const now = new Date("2026-10-12T12:00:00Z");
test("janela aberta até 24h após a última mensagem recebida", () => {
  expect(isInstagramWindowOpen("2026-10-11T12:00:01Z", now)).toBe(true);
  expect(isInstagramWindowOpen("2026-10-11T12:00:00Z", now)).toBe(false);
});
test("sem mensagem recebida ou data inválida a janela está fechada", () => {
  expect(isInstagramWindowOpen(null, now)).toBe(false);
  expect(isInstagramWindowOpen("ontem", now)).toBe(false);
});
