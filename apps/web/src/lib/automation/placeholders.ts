import { TEMPLATE_PLACEHOLDER, type AutomationGraph, type GraphIssue } from "@flowai/core";

export const TEMPLATE_EXAMPLE_URL = "https://exemplo.com.br";
export const PLACEHOLDER_MESSAGE = "Edite este campo antes de ativar.";

const RESERVED = new Set<string>([...Object.values(TEMPLATE_PLACEHOLDER), TEMPLATE_EXAMPLE_URL]);

function hasPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return RESERVED.has(value.trim());
  if (Array.isArray(value)) return value.some(hasPlaceholder);
  if (typeof value === "object" && value !== null) return Object.values(value).some(hasPlaceholder);
  return false;
}

/**
 * Valores de exemplo dos modelos (referências reservadas e a URL de exemplo) que o admin precisa editar.
 * O editor trata cada um como um problema que bloqueia a ativação, além dos de `validateGraph`.
 */
export function placeholderIssues(graph: AutomationGraph, triggerConfig: unknown): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  if (hasPlaceholder(triggerConfig)) issues.push({ nodeId: trigger?.id ?? null, code: "placeholder", message: PLACEHOLDER_MESSAGE });
  for (const n of graph.nodes) {
    if (hasPlaceholder(n.config)) issues.push({ nodeId: n.id, code: "placeholder", message: PLACEHOLDER_MESSAGE });
  }
  return issues;
}
