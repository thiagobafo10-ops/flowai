import { expect, test } from "vitest";
import { readyEntryLink } from "./link";
test("gera URL do Instagram pelo usuário da conta e pelo código", () => {
  expect(readyEntryLink({ type: "instagram", username: "loja.x" }, "promo10")).toBe("https://ig.me/m/loja.x?ref=promo10");
});
test("sem usuário e no Simulador não inventa link público", () => {
  expect(readyEntryLink({ type: "instagram", username: null }, "promo10")).toBeNull();
  expect(readyEntryLink({ type: "simulator", username: null }, "promo10")).toBeNull();
});
