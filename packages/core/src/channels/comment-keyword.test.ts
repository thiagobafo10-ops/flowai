import { expect, it } from "vitest";
import { matchesCommentKeyword } from "./index.ts";

it.each([
  ["Quero o GUIA!", "guia", true], ["preço", "PRECO", true],
  ["quero   saber mais", "saber mais", true], ["guiado", "guia", false],
  ["antiguia", "guia", false], ["", "guia", false], ["guia", "", false],
  ["guia", "   ", false], ["東京!", "東京", true], ["A guia B", "guia", true],
  ["guia1", "guia", false], ["quero saber\nmais", "saber mais", true],
])("matches whole keyword %j against %j = %s", (text, keyword, expected) => {
  expect(matchesCommentKeyword(text, keyword)).toBe(expected);
});
