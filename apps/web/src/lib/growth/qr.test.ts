import { expect, test } from "vitest";
import { entryLinkQrSvg } from "./qr";
test("gera SVG real não vazio para link de entrada", async () => {
  const svg = await entryLinkQrSvg("https://ig.me/m/loja.x?ref=promo10");
  expect(svg).toMatch(/^<svg/);
  expect(svg).toContain("viewBox=");
  expect(svg).toContain("<path");
  expect(svg.length).toBeGreaterThan(100);
});
