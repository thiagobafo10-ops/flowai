import { expect, test } from "vitest";
import { automationTemplates } from "@flowai/core";
import { instantiateTemplate } from "./instantiate";
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

test("convite ao grupo só deixa a URL de exemplo para o admin editar", () => {
  const { graph, triggerConfig } = instantiateTemplate(template("group_invite"), {
    channelId: "00000000-0000-4000-8000-0000000000c9",
    tagId: "t1",
    tagId2: "t2",
    stageId: null,
  });
  const issues = placeholderIssues(graph, triggerConfig);
  expect(issues).toHaveLength(1);
  // O aviso fica na mensagem do convite (a URL de exemplo), e não nas etiquetas.
  expect(graph.nodes.find((n) => n.id === issues[0]!.nodeId)!.type).toBe("message");
});
