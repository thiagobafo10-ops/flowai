import { expect, test } from "vitest";
import { automationTemplates } from "@flowai/core";
import { placeholderIssues } from "./placeholders";

const template = (key: string) => automationTemplates.find((t) => t.key === key)!;

test("aponta o canal reservado no gatilho e a URL de exemplo", () => {
  const t = template("comment_link");
  const issues = placeholderIssues(t.graph, t.triggerConfig);
  expect(issues).toEqual([
    { nodeId: "trigger", code: "placeholder", message: "Edite este campo antes de ativar." },
    { nodeId: "link", code: "placeholder", message: "Edite este campo antes de ativar." },
  ]);
});

test("aponta etiqueta e etapa reservadas", () => {
  const t = template("qualify_buttons");
  expect(placeholderIssues(t.graph, t.triggerConfig).map((i) => i.nodeId)).toEqual(["tag", "stage"]);
});

test("sem espaços reservados não há avisos", () => {
  const t = template("welcome_direct");
  expect(placeholderIssues(t.graph, t.triggerConfig)).toEqual([]);
});
