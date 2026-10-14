import { describe, expect, it } from "vitest";
import {
  automationAiOutputSchema,
  buildAutomationPrompt,
  sanitizeAndValidateGeneratedGraph,
  type GeneratorRefs,
} from "./ai-generator.ts";
import type { AutomationGraph } from "./schemas.ts";

const MOCK_REFS: GeneratorRefs = {
  tags: [
    { id: "11111111-1111-4000-8000-000000000001", name: "VIP" },
    { id: "11111111-1111-4000-8000-000000000002", name: "Interessado" },
  ],
  stages: [
    { id: "22222222-2222-4000-8000-000000000001", name: "Novo Lead" },
    { id: "22222222-2222-4000-8000-000000000002", name: "Negociação" },
  ],
  channels: [
    { id: "33333333-3333-4000-8000-000000000001", name: "Instagram Principal", type: "instagram" },
  ],
  entryLinks: [
    { id: "44444444-4444-4000-8000-000000000001", name: "Bio Instagram" },
  ],
  sequences: [
    { id: "55555555-5555-4000-8000-000000000001", name: "Nutrição 3 Dias" },
  ],
};

describe("automationAiOutputSchema", () => {
  it("valida um output estruturado completo e correto", () => {
    const valid = {
      name: "Qualificação de Orçamento",
      triggerType: "message_received",
      triggerConfig: { firstMessageOnly: true },
      explanation: "Quando o contato mandar a primeira mensagem, enviamos opções de atendimento e marcamos como Interessado.",
      nodes: [
        { id: "trigger_1", type: "trigger", config: { firstMessageOnly: true } },
        { id: "msg_1", type: "message", config: { mode: "text", text: "Olá! Como posso ajudar?" } },
        { id: "tag_1", type: "tag", config: { tagId: "11111111-1111-4000-8000-000000000002" } },
        { id: "end_1", type: "end", config: {} },
      ],
      edges: [
        { source: "trigger_1", target: "msg_1", sourceHandle: "default" },
        { source: "msg_1", target: "tag_1", sourceHandle: "default" },
        { source: "tag_1", target: "end_1", sourceHandle: "default" },
      ],
    };

    const res = automationAiOutputSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it("rejeita tipos de nós desconhecidos", () => {
    const invalid = {
      name: "Fluxo Inválido",
      triggerType: "message_received",
      triggerConfig: {},
      explanation: "Teste",
      nodes: [
        { id: "n1", type: "tipo_que_nao_existe", config: {} },
      ],
      edges: [],
    };

    const res = automationAiOutputSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });
});

describe("buildAutomationPrompt", () => {
  it("injeta o prompt do usuário e o catálogo de referências reais", () => {
    const prompt = buildAutomationPrompt("Quero um fluxo para quem comentar PROMO no Instagram", MOCK_REFS);

    expect(prompt).toContain("Quero um fluxo para quem comentar PROMO no Instagram");
    expect(prompt).toContain("VIP");
    expect(prompt).toContain("11111111-1111-4000-8000-000000000001");
    expect(prompt).toContain("Instagram Principal");
    expect(prompt).toContain("Nutrição 3 Dias");
  });

  it("inclui o contexto do grafo atual quando fornecido para refinamento", () => {
    const currentGraph: AutomationGraph = {
      nodes: [
        { id: "t1", type: "trigger", config: {}, position: { x: 0, y: 0 } },
        { id: "m1", type: "message", config: { text: "Olá" }, position: { x: 0, y: 100 } },
      ],
      edges: [{ id: "e1", source: "t1", target: "m1", sourceHandle: "default" }],
    };

    const prompt = buildAutomationPrompt("Mude a mensagem para dizer Bom dia", MOCK_REFS, currentGraph);

    expect(prompt).toContain("Mude a mensagem para dizer Bom dia");
    expect(prompt).toContain("GRAFO ATUAL A SER REFINADO");
    expect(prompt).toContain('"id": "m1"');
  });
});

describe("sanitizeAndValidateGeneratedGraph", () => {
  const GRAPH_REFS = {
    tagIds: ["11111111-1111-4000-8000-000000000001"],
    stageIds: ["22222222-2222-4000-8000-000000000001"],
    userIds: ["66666666-6666-4000-8000-000000000001"],
    channelIds: ["33333333-3333-4000-8000-000000000001"],
    sequenceIds: ["55555555-5555-4000-8000-000000000001"],
    entryLinkIds: ["44444444-4444-4000-8000-000000000001"],
  };

  it("preserva fechamento seguido de fim como grafo válido", () => {
    const result = sanitizeAndValidateGeneratedGraph({
      triggerConfig: { firstMessageOnly: false },
      nodes: [
        { id: "trigger", type: "trigger", config: {} },
        { id: "close", type: "close_conversation", config: {} },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { source: "trigger", target: "close", sourceHandle: "default" },
        { source: "close", target: "end", sourceHandle: "default" },
      ],
    }, GRAPH_REFS);
    expect(result.graph.edges.map((e) => `${e.source}->${e.target}`)).toEqual(["trigger->close", "close->end"]);
    expect(result.issues).toEqual([]);
  });

  it("preserva cada ramo de respostas rápidas e ausência de resposta", () => {
    const result = sanitizeAndValidateGeneratedGraph({
      triggerConfig: { firstMessageOnly: false },
      nodes: [
        { id: "trigger", type: "trigger", config: {} },
        { id: "menu", type: "message", config: { mode: "text", text: "Escolha", quickReplies: [
          { id: "sim", title: "Sim" }, { id: "nao", title: "Não" },
        ] } },
        ...["aceite", "recusa", "silencio"].map((id) => ({ id, type: "end", config: {} })),
      ],
      edges: [
        { source: "trigger", target: "menu", sourceHandle: "default" },
        { source: "menu", target: "aceite", sourceHandle: "opt:sim" },
        { source: "menu", target: "recusa", sourceHandle: "opt:nao" },
        { source: "menu", target: "silencio", sourceHandle: "no_reply" },
      ],
    }, GRAPH_REFS);
    expect(result.graph.edges.filter((e) => e.source === "menu").map((e) => [e.sourceHandle, e.target])).toEqual([
      ["opt:sim", "aceite"], ["opt:nao", "recusa"], ["no_reply", "silencio"],
    ]);
    expect(result.issues).toEqual([]);
  });

  it.each([
    { buttons: [{ id: "sim", title: "Sim", kind: "path" }], handle: "opt:forjado" },
    { buttons: [{ id: "site", title: "Site", kind: "url", url: "https://example.com" }], handle: "opt:site" },
    { quickReplies: [{ id: "sim", title: "Sim" }], handle: "opt:forjado" },
    { handle: "opt:forjado" },
  ])("não reatribui saída inexistente de mensagem: %j", ({ handle, ...options }) => {
    const result = sanitizeAndValidateGeneratedGraph({
      triggerConfig: { firstMessageOnly: false },
      nodes: [
        { id: "trigger", type: "trigger", config: {} },
        { id: "menu", type: "message", config: { mode: "text", text: "Escolha", ...options } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { source: "trigger", target: "menu", sourceHandle: "default" },
        { source: "menu", target: "end", sourceHandle: handle },
      ],
    }, GRAPH_REFS);
    expect(result.graph.edges.filter((e) => e.source === "menu")).toEqual([]);
    expect(result.issues.some((i) => i.nodeId === "menu" && i.code === "missing_handle")).toBe(true);
  });

  it.each([
    ["tag", "tagId", "unknown_tag"], ["remove_tag", "tagId", "unknown_tag"],
    ["move_stage", "stageId", "unknown_stage"], ["assign_user", "userId", "unknown_user"],
    ["sequence_enroll", "sequenceId", "unknown_sequence"], ["sequence_remove", "sequenceId", "unknown_sequence"],
  ])("não aceita referência indisponível em %s mesmo sendo UUID", (type, field, code) => {
    const result = sanitizeAndValidateGeneratedGraph({
      triggerConfig: { firstMessageOnly: false },
      nodes: [
        { id: "trigger", type: "trigger", config: {} },
        { id: "action", type, config: { [field]: "99999999-9999-4000-8000-000000000001" } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { source: "trigger", target: "action", sourceHandle: "default" },
        { source: "action", target: "end", sourceHandle: "default" },
      ],
    }, GRAPH_REFS);
    expect(result.issues.map((i) => [i.nodeId, i.code])).toEqual([["action", code]]);
  });

  it("valida a proibição de ações após fechar a conversa", () => {
    const result = sanitizeAndValidateGeneratedGraph({
      triggerConfig: { firstMessageOnly: false },
      nodes: [
        { id: "trigger", type: "trigger", config: {} },
        { id: "close", type: "close_conversation", config: {} },
        { id: "message", type: "message", config: { mode: "text", text: "Oi" } },
        { id: "end", type: "end", config: {} },
      ],
      edges: [
        { source: "trigger", target: "close", sourceHandle: "default" },
        { source: "close", target: "message", sourceHandle: "default" },
        { source: "message", target: "end", sourceHandle: "default" },
      ],
    }, GRAPH_REFS);
    expect(result.issues.map((i) => [i.nodeId, i.code])).toEqual([["close", "after_close"]]);
  });

  it("remove arestas desconexas, auto-loops e arestas saindo de nós terminais", () => {
    const raw = {
      name: "Fluxo com pontas soltas",
      triggerType: "message_received",
      triggerConfig: { firstMessageOnly: true },
      explanation: "Teste de sanitização",
      nodes: [
        { id: "trig", type: "trigger", config: {} },
        { id: "msg", type: "message", config: { mode: "text", text: "Olá" } },
        { id: "fim", type: "end", config: {} },
      ],
      edges: [
        { source: "trig", target: "msg", sourceHandle: "default" },
        { source: "msg", target: "fim", sourceHandle: "default" },
        // Aresta saindo de nó terminal (deve ser removida)
        { source: "fim", target: "msg", sourceHandle: "default" },
        // Aresta apontando para nó inexistente (deve ser removida)
        { source: "msg", target: "fantasma", sourceHandle: "default" },
        // Auto-loop (deve ser removido)
        { source: "msg", target: "msg", sourceHandle: "default" },
      ],
    };

    const result = sanitizeAndValidateGeneratedGraph(raw, GRAPH_REFS);

    expect(result.graph.edges).toHaveLength(2);
    expect(result.graph.edges.map((e) => `${e.source}->${e.target}`)).toEqual([
      "trig->msg",
      "msg->fim",
    ]);
  });

  it("insere nó trigger automaticamente se a IA o omitir e conecta ao primeiro nó", () => {
    const raw = {
      name: "Fluxo sem trigger inicial",
      triggerType: "keyword_detected",
      triggerConfig: { keywords: ["ajuda"], mode: "contains" },
      explanation: "Fluxo criado sem nó trigger explícito",
      nodes: [
        { id: "msg1", type: "message", config: { mode: "text", text: "Em que posso ajudar?" } },
        { id: "end1", type: "end", config: {} },
      ],
      edges: [
        { source: "msg1", target: "end1", sourceHandle: "default" },
      ],
    };

    const result = sanitizeAndValidateGeneratedGraph(raw, GRAPH_REFS);

    const triggerNode = result.graph.nodes.find((n) => n.type === "trigger");
    expect(triggerNode).toBeDefined();
    // Deve haver conexão partindo do trigger para msg1
    const edgeFromTrigger = result.graph.edges.find((e) => e.source === triggerNode!.id);
    expect(edgeFromTrigger).toBeDefined();
    expect(edgeFromTrigger!.target).toBe("msg1");
  });

  it("corrige handles de condição e mensagem sem botões", () => {
    const raw = {
      name: "Correção de Handles",
      triggerType: "message_received",
      triggerConfig: { firstMessageOnly: false },
      explanation: "Ajuste de handles",
      nodes: [
        { id: "trig", type: "trigger", config: {} },
        { id: "cond", type: "condition", config: { kind: "has_tag", tagId: GRAPH_REFS.tagIds[0] } },
        { id: "msg_sim", type: "message", config: { mode: "text", text: "Cliente VIP" } },
        { id: "msg_nao", type: "message", config: { mode: "text", text: "Novo cliente" } },
      ],
      edges: [
        { source: "trig", target: "cond", sourceHandle: null },
        // A IA gerou 'yes' e 'no' em vez de 'true' e 'false'
        { source: "cond", target: "msg_sim", sourceHandle: "yes" },
        { source: "cond", target: "msg_nao", sourceHandle: "no" },
      ],
    };

    const result = sanitizeAndValidateGeneratedGraph(raw, GRAPH_REFS);

    const condEdges = result.graph.edges.filter((e) => e.source === "cond");
    expect(condEdges.map((e) => e.sourceHandle).sort()).toEqual(["false", "true"]);
  });

  it("aplica auto-layout nos nós retornados", () => {
    const raw = {
      name: "Layout aplicado",
      triggerType: "message_received",
      triggerConfig: { firstMessageOnly: false },
      explanation: "Layout",
      nodes: [
        { id: "trig", type: "trigger", config: {} },
        { id: "msg", type: "message", config: { mode: "text", text: "Oi" } },
      ],
      edges: [
        { source: "trig", target: "msg", sourceHandle: "default" },
      ],
    };

    const result = sanitizeAndValidateGeneratedGraph(raw, GRAPH_REFS);

    const trig = result.graph.nodes.find((n) => n.id === "trig")!;
    const msg = result.graph.nodes.find((n) => n.id === "msg")!;

    expect(trig.position.y).toBeLessThan(msg.position.y);
  });
});

