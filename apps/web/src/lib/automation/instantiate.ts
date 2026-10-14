import { randomUUID } from "node:crypto";
import { TEMPLATE_PLACEHOLDER, type AutomationGraph, type AutomationTemplate } from "@flowai/core";

export type TemplateDefaults = { channelId: string | null; tagId: string | null; stageId: string | null };

/**
 * Cria cópia do modelo com ids de nós/arestas novos (v4) e as referências reais da organização.
 * Sem referência disponível, o espaço reservado é mantido: o editor aponta o problema.
 */
export function instantiateTemplate(
  template: AutomationTemplate,
  defaults: TemplateDefaults,
  newId: () => string = randomUUID,
): { triggerConfig: unknown; graph: AutomationGraph } {
  const swaps: [string, string | null][] = [
    [TEMPLATE_PLACEHOLDER.channelId, defaults.channelId],
    [TEMPLATE_PLACEHOLDER.tagId, defaults.tagId],
    [TEMPLATE_PLACEHOLDER.stageId, defaults.stageId],
  ];
  const nodeIds = new Map(template.graph.nodes.map((n) => [n.id, newId()]));
  let text = JSON.stringify({ triggerConfig: template.triggerConfig, graph: template.graph });
  for (const [placeholder, real] of swaps) if (real) text = text.split(placeholder).join(real);
  const copy = JSON.parse(text) as { triggerConfig: unknown; graph: AutomationGraph };
  return {
    triggerConfig: copy.triggerConfig,
    graph: {
      nodes: copy.graph.nodes.map((n) => ({ ...n, id: nodeIds.get(n.id)! })),
      edges: copy.graph.edges.map((e) => ({
        ...e,
        id: newId(),
        source: nodeIds.get(e.source)!,
        target: nodeIds.get(e.target)!,
      })),
    },
  };
}
