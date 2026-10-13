import { describe, expect, test } from "vitest";
import { automationTemplates, requiredHandles, type AutomationGraph } from "@flowai/core";
import { connectEdge, fromFlow, nodeHandles, toFlow, updateNodeConfig } from "./graph-mapping";

const template = (key: string) => automationTemplates.find((t) => t.key === key)!;

describe("toFlow / fromFlow", () => {
  test.each(automationTemplates.map((t) => [t.key, t] as const))("ida e volta idêntica para o modelo %s", (_key, t) => {
    const { nodes, edges } = toFlow(t.graph);
    expect(fromFlow(nodes, edges)).toEqual(t.graph);
  });

  test("mantém posições e saídas e marca o gatilho como não excluível", () => {
    const { nodes, edges } = toFlow(template("comment_link").graph);
    const link = nodes.find((n) => n.id === "link")!;
    expect(link.position).toEqual({ x: -120, y: 300 });
    expect(link.type).toBe("message");
    expect(nodes.find((n) => n.id === "trigger")!.deletable).toBe(false);
    expect(edges.find((e) => e.id === "e2")).toMatchObject({ source: "ask", target: "link", sourceHandle: "opt:quero" });
  });

  test("fromFlow usa a saída default quando a aresta não tem handle", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "a", type: "trigger", config: {}, position: { x: 0, y: 0 } },
        { id: "b", type: "end", config: {}, position: { x: 0, y: 100 } },
      ],
      edges: [],
    };
    const { nodes } = toFlow(graph);
    const result = fromFlow(nodes, [{ id: "x", source: "a", target: "b", sourceHandle: null }]);
    expect(result.edges).toEqual([{ id: "x", source: "a", target: "b", sourceHandle: "default" }]);
  });
});

describe("updateNodeConfig", () => {
  test("remover uma resposta rápida remove a aresta da opção", () => {
    const { nodes, edges } = toFlow(template("qualify_buttons").graph);
    const ask = nodes.find((n) => n.id === "ask")!;
    const config = { ...(ask.data.config as Record<string, unknown>), quickReplies: [{ id: "sim", title: "Sim" }] };
    const next = updateNodeConfig(nodes, edges, "ask", config);
    expect(next.nodes.find((n) => n.id === "ask")!.data.config).toEqual(config);
    expect(next.edges.map((e) => e.id)).toEqual(["e1", "e2", "e4", "e5", "e6", "e7"]);
  });

  test("trocar a mensagem para IA remove as saídas de opção e de sem resposta", () => {
    const { nodes, edges } = toFlow(template("qualify_buttons").graph);
    const next = updateNodeConfig(nodes, edges, "ask", { mode: "ai" });
    expect(next.edges.map((e) => e.id)).toEqual(["e1", "e5", "e6", "e7"]);
  });
});

describe("nodeHandles", () => {
  test("as saídas seguem requiredHandles para todos os nós dos modelos", () => {
    for (const t of automationTemplates) {
      for (const n of t.graph.nodes) expect(nodeHandles(n).map((h) => h.id)).toEqual(requiredHandles(n));
    }
  });

  test("rótulos em pt-BR", () => {
    const qualify = template("qualify_buttons").graph.nodes.find((n) => n.id === "ask")!;
    expect(nodeHandles(qualify)).toEqual([
      { id: "opt:sim", label: "Sim" },
      { id: "opt:nao", label: "Ainda não" },
      { id: "no_reply", label: "Sem resposta" },
    ]);
    const comment = template("comment_link").graph.nodes.find((n) => n.id === "ask")!;
    expect(nodeHandles(comment).map((h) => h.label)).toEqual(["Quero", "Sem resposta"]);
    const position = { x: 0, y: 0 };
    expect(nodeHandles({ id: "c", type: "condition", config: {}, position })).toEqual([
      { id: "true", label: "Sim" },
      { id: "false", label: "Não" },
    ]);
    expect(nodeHandles({ id: "m", type: "message", config: { mode: "ai" }, position })).toEqual([
      { id: "sent", label: "Enviada" },
      { id: "handoff", label: "Transferiu" },
    ]);
    expect(nodeHandles({ id: "d", type: "delay", config: { minutes: 5 }, position })).toEqual([{ id: "default", label: "" }]);
    expect(nodeHandles({ id: "e", type: "end", config: {}, position })).toEqual([]);
    expect(nodeHandles({ id: "q", type: "message", config: { mode: "text", text: "Oi", quickReplies: [{ id: "x1", title: " " }] }, position })[0]).toEqual({
      id: "opt:x1",
      label: "Sem título",
    });
  });
});

describe("connectEdge", () => {
  test("uma ligação por saída: conectar de novo substitui a anterior", () => {
    const { edges } = toFlow(template("qualify_buttons").graph);
    const next = connectEdge(edges, { source: "ask", target: "stage", sourceHandle: "opt:nao" }, () => "new");
    expect(next.filter((e) => e.source === "ask" && e.sourceHandle === "opt:nao")).toEqual([
      expect.objectContaining({ id: "new", target: "stage" }),
    ]);
    expect(next).toHaveLength(edges.length);
  });

  test("sem handle conecta pela saída default", () => {
    const next = connectEdge([], { source: "a", target: "b", sourceHandle: null }, () => "x");
    expect(next).toEqual([expect.objectContaining({ id: "x", source: "a", target: "b", sourceHandle: "default" })]);
  });
});
