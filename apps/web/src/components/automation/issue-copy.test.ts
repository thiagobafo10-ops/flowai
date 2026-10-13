import { describe, expect, test } from "vitest";
import { automationTemplates, validateGraph, type AutomationGraph, type GraphRefs } from "@flowai/core";
import { friendlyMessage, presentIssues } from "./issue-copy";

const refs: GraphRefs = { tagIds: [], stageIds: [], userIds: [], channelIds: [] };
const trigger = { type: "message_received" as const, config: { firstMessageOnly: false } };
const position = { x: 0, y: 0 };
const present = (graph: AutomationGraph) => presentIssues(validateGraph(graph, trigger, refs), graph);
const handleIssues = (graph: AutomationGraph) => present(graph).filter((i) => i.code.endsWith("_handle"));

describe("presentIssues", () => {
  test("saída de resposta rápida sem conexão usa o título da opção", () => {
    const qualify = automationTemplates.find((t) => t.key === "qualify_buttons")!.graph;
    const graph = { ...qualify, edges: qualify.edges.filter((e) => e.sourceHandle !== "opt:nao") };
    expect(handleIssues(graph)).toEqual([{ nodeId: "ask", code: "missing_handle", message: 'Conecte a saída "Ainda não" de "Mensagem".' }]);
  });

  test("saída default vira saída principal; condição usa Sim/Não; sem resposta e IA rotulados", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t", type: "trigger", config: {}, position },
        { id: "d", type: "delay", config: { minutes: 5 }, position },
        { id: "c", type: "condition", config: { kind: "lead_score_gte", value: 10 }, position },
        { id: "q", type: "message", config: { mode: "text", text: "Oi", quickReplies: [{ id: "a1", title: "" }] }, position },
        { id: "ai", type: "message", config: { mode: "ai" }, position },
      ],
      edges: [
        { id: "e1", source: "t", target: "d", sourceHandle: "default" },
        { id: "e2", source: "t", target: "c", sourceHandle: "default" },
        { id: "e3", source: "c", target: "q", sourceHandle: "true" },
        { id: "e4", source: "q", target: "ai", sourceHandle: "opt:a1" },
      ],
    };
    const messages = handleIssues(graph).map((i) => i.message);
    expect(messages).toEqual(expect.arrayContaining([
      'Conecte a saída principal de "Espera".',
      'Conecte a saída "Não" de "Condição".',
      'Conecte a saída "Sem resposta" de "Mensagem".',
      'Conecte a saída "Enviada" de "Mensagem".',
      'Conecte a saída "Transferiu" de "Mensagem".',
      'A saída principal de "Gatilho" tem mais de uma conexão.',
    ]));
    for (const m of present(graph).map((i) => i.message)) expect(m).not.toMatch(/opt:|no_reply|"default"|"true"|"false"|"sent"|"handoff"/);
  });

  test("conexão em saída removida e opção sem título", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t", type: "trigger", config: {}, position },
        { id: "q", type: "message", config: { mode: "text", text: "Oi", quickReplies: [{ id: "a1", title: "" }] }, position },
        { id: "e", type: "end", config: {}, position },
      ],
      edges: [
        { id: "e1", source: "t", target: "q", sourceHandle: "default" },
        { id: "e2", source: "q", target: "e", sourceHandle: "opt:zz" },
        { id: "e3", source: "q", target: "e", sourceHandle: "no_reply" },
      ],
    };
    expect(handleIssues(graph).map((i) => i.message)).toEqual([
      'Conecte a saída "Sem título" de "Mensagem".',
      '"Mensagem" tem uma conexão em uma saída que não existe mais.',
    ]);
  });
});

describe("friendlyMessage", () => {
  test("seleção vazia e número em branco em pt-BR", () => {
    expect(friendlyMessage("Gatilho: Identificador inválido. Informe ao menos uma palavra-chave.")).toBe(
      "Gatilho: Escolha uma opção. Informe ao menos uma palavra-chave.",
    );
    expect(friendlyMessage("Mensagem: Invalid input: expected number, received null")).toBe("Mensagem: Informe um número.");
    expect(friendlyMessage("Invalid input: expected number, received NaN")).toBe("Informe um número.");
    expect(friendlyMessage("A etiqueta usada não existe mais.")).toBe("A etiqueta usada não existe mais.");
  });
});
