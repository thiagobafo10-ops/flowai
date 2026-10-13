import type { Edge, Node } from "@xyflow/react";
import { requiredHandles, type AutomationGraph, type NodeType } from "@flowai/core";

export type FlowNodeData = { config: unknown };
export type FlowNode = Node<FlowNodeData, NodeType>;
export type FlowEdge = Edge & { sourceHandle: string };
export type HandleSpec = { id: string; label: string };

type GraphNode = AutomationGraph["nodes"][number];
type ConnectionLike = { source: string; target: string; sourceHandle?: string | null };

const FIXED_LABELS: Record<string, string> = {
  default: "",
  true: "Sim",
  false: "Não",
  no_reply: "Sem resposta",
  sent: "Enviada",
  handoff: "Transferiu",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Grafo salvo → nós e arestas do React Flow (posições e saídas preservadas). */
export function toFlow(graph: AutomationGraph): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: { config: n.config },
      ...(n.type === "trigger" ? { deletable: false } : {}),
    })),
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle })),
  };
}

/** Nós e arestas do React Flow → grafo salvo (sem estado de seleção ou medidas). */
export function fromFlow(nodes: FlowNode[], edges: Edge[]): AutomationGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type as NodeType,
      config: n.data.config,
      position: { x: n.position.x, y: n.position.y },
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "default" })),
  };
}

/** Saídas do nó (as de `requiredHandles`), com rótulo: títulos das opções, "Sim"/"Não", "Sem resposta"... */
export function nodeHandles(node: Pick<GraphNode, "type" | "config"> & Partial<GraphNode>): HandleSpec[] {
  const titles = new Map<string, string>();
  if (isRecord(node.config)) {
    for (const list of [node.config.buttons, node.config.quickReplies]) {
      if (!Array.isArray(list)) continue;
      for (const o of list) if (isRecord(o) && typeof o.id === "string") titles.set(o.id, typeof o.title === "string" ? o.title : "");
    }
  }
  const full: GraphNode = { id: node.id ?? "", position: node.position ?? { x: 0, y: 0 }, type: node.type, config: node.config };
  return requiredHandles(full).map((id) => ({
    id,
    label: id.startsWith("opt:") ? titles.get(id.slice(4)) || id.slice(4) : (FIXED_LABELS[id] ?? id),
  }));
}

/** Troca a configuração de um nó e remove as arestas que saíam de saídas que deixaram de existir. */
export function updateNodeConfig(
  nodes: FlowNode[],
  edges: FlowEdge[],
  nodeId: string,
  config: unknown,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const target = nodes.find((n) => n.id === nodeId);
  if (!target) return { nodes, edges };
  const handles = new Set(nodeHandles({ type: target.type as NodeType, config }).map((h) => h.id));
  return {
    nodes: nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, config } } : n)),
    edges: edges.filter((e) => e.source !== nodeId || handles.has(e.sourceHandle)),
  };
}

/** Nova ligação; cada saída (nó + handle) tem no máximo uma, então a anterior é substituída. */
export function connectEdge(edges: FlowEdge[], connection: ConnectionLike, newId: () => string): FlowEdge[] {
  const sourceHandle = connection.sourceHandle ?? "default";
  const kept = edges.filter((e) => !(e.source === connection.source && e.sourceHandle === sourceHandle));
  return [...kept, { id: newId(), source: connection.source, target: connection.target, sourceHandle }];
}
