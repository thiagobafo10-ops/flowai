import type { AutomationGraph, GraphIssue, NodeType } from "@flowai/core";
import { nodeHandles } from "./graph-mapping";
import { NODE_LABEL } from "@/lib/automation/node-labels";

/** Mensagens padrão do Zod/core que aparecem para o usuário, reescritas em linguagem de formulário. */
export function friendlyMessage(message: string): string {
  return message
    .replace(/Identificador inválido\./g, "Escolha uma opção.")
    .replace(/Invalid input: expected number, received \w+/g, "Informe um número.");
}

const HANDLE_IN_MESSAGE = /saída (?:inexistente )?"([^"]+)"/;

function handlePhrase(handle: string, label: string | undefined): string | null {
  if (handle === "default") return "a saída principal";
  return label === undefined ? null : `a saída "${label}"`;
}

/**
 * Reescreve os problemas de saídas (`missing_handle`, `extra_handle`, `duplicate_handle`) com os rótulos que o
 * editor mostra no nó — título da opção, "Sem resposta", "Sim"/"Não", "Enviada"/"Transferiu", "saída principal" —
 * em vez dos identificadores internos, e suaviza as demais mensagens com `friendlyMessage`.
 */
export function presentIssues(issues: GraphIssue[], graph: AutomationGraph): GraphIssue[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return issues.map((issue) => {
    const node = issue.nodeId ? byId.get(issue.nodeId) : undefined;
    const handle = issue.message.match(HANDLE_IN_MESSAGE)?.[1];
    if (!node || !handle || !["missing_handle", "extra_handle", "duplicate_handle"].includes(issue.code)) {
      return { ...issue, message: friendlyMessage(issue.message) };
    }
    const name = NODE_LABEL[node.type as NodeType];
    const label = nodeHandles(node).find((h) => h.id === handle)?.label;
    const phrase = handlePhrase(handle, label);
    let message: string;
    if (issue.code === "extra_handle" || !phrase) {
      message = `"${name}" tem uma conexão em uma saída que não existe mais.`;
    } else if (issue.code === "missing_handle") {
      message = `Conecte ${phrase} de "${name}".`;
    } else {
      message = `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} de "${name}" tem mais de uma conexão.`;
    }
    return { ...issue, message };
  });
}
