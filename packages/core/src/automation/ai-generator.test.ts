import { describe, expect, it } from "vitest";
import {
  automationAiOutputSchema,
  buildAutomationPrompt,
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
