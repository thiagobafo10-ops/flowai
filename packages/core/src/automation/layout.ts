import type { AutomationGraph } from "./schemas.ts";

type GraphNode = AutomationGraph["nodes"][number];

const VERTICAL_SPACING = 140;
const HORIZONTAL_SPACING = 260;

/**
 * Calcula layout determinístico top-down para posicionar os nós
 * de um grafo de automação no canvas sem sobreposições.
 */
export function applyAutoLayout(graph: AutomationGraph): AutomationGraph {
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];

  if (nodes.length === 0) return { nodes: [], edges };

  // Mapeia arestas de saída e entrada
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }

  for (const edge of edges) {
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  // Identifica raiz: nó do tipo trigger ou nó sem arestas de entrada
  const triggerNode = nodes.find((n) => n.type === "trigger");
  const rootId = triggerNode?.id ?? nodes.find((n) => (incoming.get(n.id)?.length ?? 0) === 0)?.id ?? nodes[0]?.id;

  // BFS para agrupar nós por profundidade (nível)
  const nodeDepth = new Map<string, number>();
  const queue: { id: string; depth: number }[] = [];
  const visited = new Set<string>();

  if (rootId) {
    queue.push({ id: rootId, depth: 0 });
    visited.add(rootId);
    nodeDepth.set(rootId, 0);
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const targets = outgoing.get(id) ?? [];

    for (const targetId of targets) {
      if (!visited.has(targetId)) {
        visited.add(targetId);
        nodeDepth.set(targetId, depth + 1);
        queue.push({ id: targetId, depth: depth + 1 });
      }
    }
  }

  // Agrupa por níveis
  const levels = new Map<number, string[]>();
  for (const [id, depth] of nodeDepth.entries()) {
    if (!levels.has(depth)) levels.set(depth, []);
    levels.get(depth)!.push(id);
  }

  // Calcula coordenadas (x, y)
  const positions = new Map<string, { x: number; y: number }>();

  for (const [depth, levelNodes] of levels.entries()) {
    const total = levelNodes.length;
    const y = depth * VERTICAL_SPACING;

    levelNodes.forEach((id, index) => {
      let x = 0;
      if (total > 1) {
        x = (index - (total - 1) / 2) * HORIZONTAL_SPACING;
      }
      positions.set(id, { x: Math.round(x), y: Math.round(y) });
    });
  }

  // Trata nós desconexos que não foram alcançados pela raiz
  let unvisitedIndex = 0;
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, {
        x: HORIZONTAL_SPACING + 100,
        y: unvisitedIndex * VERTICAL_SPACING,
      });
      unvisitedIndex++;
    }
  }

  const laidOutNodes: GraphNode[] = nodes.map((n) => ({
    ...n,
    position: positions.get(n.id) ?? { x: 0, y: 0 },
  }));

  return {
    nodes: laidOutNodes,
    edges,
  };
}
