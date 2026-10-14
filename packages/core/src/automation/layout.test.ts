import { describe, expect, it } from "vitest";
import { applyAutoLayout } from "./layout.ts";
import type { AutomationGraph } from "./schemas.ts";

describe("applyAutoLayout", () => {
  it("posiciona um fluxo linear com coordenadas verticais progressivas", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "trig", type: "trigger", config: {}, position: { x: 0, y: 0 } },
        { id: "msg", type: "message", config: { text: "Olá" }, position: { x: 0, y: 0 } },
        { id: "del", type: "delay", config: { minutes: 60 }, position: { x: 0, y: 0 } },
        { id: "fim", type: "end", config: {}, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "trig", target: "msg", sourceHandle: "default" },
        { id: "e2", source: "msg", target: "del", sourceHandle: "default" },
        { id: "e3", source: "del", target: "fim", sourceHandle: "default" },
      ],
    };

    const laidOut = applyAutoLayout(graph);

    const trig = laidOut.nodes.find((n) => n.id === "trig")!;
    const msg = laidOut.nodes.find((n) => n.id === "msg")!;
    const del = laidOut.nodes.find((n) => n.id === "del")!;
    const fim = laidOut.nodes.find((n) => n.id === "fim")!;

    expect(trig.position.y).toBeLessThan(msg.position.y);
    expect(msg.position.y).toBeLessThan(del.position.y);
    expect(del.position.y).toBeLessThan(fim.position.y);

    // Em fluxo linear sem ramos, todos devem estar centralizados no mesmo eixo x
    expect(trig.position.x).toBe(msg.position.x);
    expect(msg.position.x).toBe(del.position.x);
    expect(del.position.x).toBe(fim.position.x);
  });

  it("distribui ramos horizontais sem sobreposição em condições", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "trig", type: "trigger", config: {}, position: { x: 0, y: 0 } },
        { id: "cond", type: "condition", config: { kind: "has_tag", tagId: "t1" }, position: { x: 0, y: 0 } },
        { id: "tag_sim", type: "tag", config: { tagId: "t2" }, position: { x: 0, y: 0 } },
        { id: "msg_nao", type: "message", config: { text: "Sem tag" }, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "trig", target: "cond", sourceHandle: "default" },
        { id: "e_sim", source: "cond", target: "tag_sim", sourceHandle: "true" },
        { id: "e_nao", source: "cond", target: "msg_nao", sourceHandle: "false" },
      ],
    };

    const laidOut = applyAutoLayout(graph);

    const tagSim = laidOut.nodes.find((n) => n.id === "tag_sim")!;
    const msgNao = laidOut.nodes.find((n) => n.id === "msg_nao")!;

    // Os dois ramos sucessores imediatos da condição ficam na mesma profundidade (mesmo y)
    expect(tagSim.position.y).toBe(msgNao.position.y);

    // E separados horizontalmente (x diferente)
    expect(tagSim.position.x).not.toBe(msgNao.position.x);
  });

  it("preserva dados, nós e arestas sem mutação indesejada", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "trig", type: "trigger", config: { custom: 123 }, position: { x: 99, y: 99 } },
      ],
      edges: [],
    };

    const laidOut = applyAutoLayout(graph);
    expect(laidOut.nodes[0]!.id).toBe("trig");
    expect(laidOut.nodes[0]!.type).toBe("trigger");
    expect(laidOut.nodes[0]!.config).toEqual({ custom: 123 });
  });
});
