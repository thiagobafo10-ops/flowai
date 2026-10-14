import { expect, test } from "vitest";
import { editorView } from "./editor-view";

test("com dados o editor continua montado, mesmo se a recarga falhar", () => {
  expect(editorView({ data: {}, isError: true })).toBe("editor");
  expect(editorView({ data: {}, isError: false })).toBe("editor");
});

test("sem dados e com erro mostra a tela de erro", () => {
  expect(editorView({ data: undefined, isError: true })).toBe("error");
});

test("sem dados e sem erro está carregando", () => {
  expect(editorView({ data: undefined, isError: false })).toBe("loading");
});
