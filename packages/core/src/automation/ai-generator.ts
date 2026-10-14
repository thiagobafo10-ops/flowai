import { z } from "zod";
import {
  NODE_TYPES,
  TRIGGER_TYPES,
  HANDLE_REGEX,
  optionId,
  type AutomationGraph,
  type NodeType,
  type TriggerType,
} from "./schemas.ts";
import { applyAutoLayout } from "./layout.ts";
import { requiredHandles, validateGraph, type GraphRefs, type GraphIssue } from "./validate.ts";

export const automationAiOutputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da automação.").max(100, "O nome deve ter até 100 caracteres."),
  triggerType: z.enum([...TRIGGER_TYPES] as [TriggerType, ...TriggerType[]]),
  triggerConfig: z.record(z.string(), z.unknown()),
  explanation: z.string().trim().min(1, "Informe a explicação do fluxo.").max(1000),
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      type: z.enum([...NODE_TYPES] as [NodeType, ...NodeType[]]),
      config: z.record(z.string(), z.unknown()),
    }),
  ),
  edges: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      sourceHandle: z.string().nullable().default(null),
    }),
  ),
});

export type AutomationAiOutput = z.infer<typeof automationAiOutputSchema>;

export type GeneratorRefs = {
  tags: { id: string; name: string }[];
  stages: { id: string; name: string }[];
  channels: { id: string; name: string; type: string }[];
  entryLinks: { id: string; name: string }[];
  sequences: { id: string; name: string }[];
};

export function buildAutomationPrompt(
  userPrompt: string,
  refs: GeneratorRefs,
  currentGraph?: AutomationGraph,
): string {
  const terminalTypes = NODE_TYPES.filter((type) => requiredHandles({
    id: type, type, config: {}, position: { x: 0, y: 0 },
  }).length === 0);
  const outputExample: AutomationAiOutput = {
    name: "Boas-vindas",
    triggerType: "message_received",
    triggerConfig: { firstMessageOnly: false },
    explanation: "Recebe uma mensagem, responde e termina o fluxo.",
    nodes: [
      { id: "trigger", type: "trigger", config: {} },
      { id: "message", type: "message", config: { mode: "text", text: "Olá! Como posso ajudar?" } },
      { id: "end", type: "end", config: {} },
    ],
    edges: [
      { source: "trigger", target: "message", sourceHandle: "default" },
      { source: "message", target: "end", sourceHandle: "default" },
    ],
  };
  const tagsList = refs.tags.length > 0
    ? refs.tags.map((t) => `- "${t.name}": ID ${t.id}`).join("\n")
    : "(Nenhuma etiqueta cadastrada)";

  const stagesList = refs.stages.length > 0
    ? refs.stages.map((s) => `- "${s.name}": ID ${s.id}`).join("\n")
    : "(Nenhuma etapa de funil cadastrada)";

  const channelsList = refs.channels.length > 0
    ? refs.channels.map((c) => `- "${c.name}" (${c.type}): ID ${c.id}`).join("\n")
    : "(Nenhum canal cadastrado)";

  const linksList = refs.entryLinks.length > 0
    ? refs.entryLinks.map((l) => `- "${l.name}": ID ${l.id}`).join("\n")
    : "(Nenhum link de entrada cadastrado)";

  const sequencesList = refs.sequences.length > 0
    ? refs.sequences.map((s) => `- "${s.name}": ID ${s.id}`).join("\n")
    : "(Nenhuma sequência de follow-up cadastrada)";

  let currentContext = "";
  if (currentGraph && currentGraph.nodes.length > 0) {
    currentContext = `
=============================================
GRAFO ATUAL A SER REFINADO / MODIFICADO:
${JSON.stringify(currentGraph, null, 2)}
=============================================
Instruções de refinamento: Mantenha a estrutura existente que não foi solicitada para alteração e aplique os ajustes ou novos passos solicitados pelo usuário.
`;
  }

  return `Você é o arquiteto especialista em automação e atendimento com IA do FlowAI.
Sua missão é converter a descrição do usuário em um fluxo de automação perfeitamente estruturado e válido.

CONTRATO DE RESPOSTA:
Responda somente com um objeto JSON válido, sem Markdown ou texto fora do JSON, tanto ao gerar quanto ao refinar.
O objeto deve conter name (string de 1 a 100 caracteres), triggerType, triggerConfig (objeto), explanation (string de 1 a 1000 caracteres), nodes (array de {id, type, config}) e edges (array de {source, target, sourceHandle}).
Use triggerType dentre: ${TRIGGER_TYPES.join(", ")}; type de nó dentre: ${NODE_TYPES.join(", ")}.
Cada config deve corresponder ao tipo do nó ou gatilho. Retorne o fluxo completo no refinamento.
Exemplo de estrutura (adapte os valores ao pedido):
\`\`\`json
${JSON.stringify(outputExample, null, 2)}
\`\`\`

DIRETRIZES FUNDAMENTAIS:
1. Responda em Português do Brasil (pt-BR).
2. O fluxo sempre DEVE começar por um nó com id "trigger" e type "trigger".
3. Conecte os nós de forma lógica e sequencial usando "edges" (source, target, sourceHandle).
4. Nós terminais (${terminalTypes.map((type) => `"${type}"`).join(", ")}) NÃO devem ter arestas de saída. "close_conversation" tem saída "default" ligada apenas a "end".
5. Para blocos de "condition":
   - Devem ter saída com sourceHandle "true" (quando atende) e sourceHandle "false" (quando não atende).
6. Para blocos de "message":
   - Podem ter botões (máximo 3) ou respostas rápidas (máximo 13).
   - Use config.mode "text" com text e buttons [{id,title,kind:"path"}] OU quickReplies [{id,title}], nunca ambos. IDs têm 1 a 12 letras minúsculas ou números, títulos até 20 caracteres.
   - Cada botão kind "path" ou resposta rápida tem saída "opt:<id>"; conecte também "no_reply". Botões kind "url" exigem URL https e não têm saída opt.
   - Se for mensagem simples sem opções de caminho, a saída usa sourceHandle "default".
   - Para config.mode "ai", conecte as saídas "sent" e "handoff".
7. Para blocos de CRM e Sequência, use OBRIGATORIAMENTE os IDs reais informados no catálogo abaixo quando aplicável:
   - "tag" e "remove_tag": config: { tagId: "<UUID_REAL>" }
   - "move_stage": config: { stageId: "<UUID_REAL>" }
   - "sequence_enroll" e "sequence_remove": config: { sequenceId: "<UUID_REAL>" }

CATÁLOGO REAL DA ORGANIZAÇÃO:
---
ETIQUETAS:
${tagsList}

ETAPAS DO FUNIL DE VENDAS:
${stagesList}

CANAIS DISPONÍVEIS:
${channelsList}

LINKS DE ENTRADA:
${linksList}

SEQUÊNCIAS DISPONÍVEIS:
${sequencesList}
---
${currentContext}

PEDIDO DO USUÁRIO:
"${userPrompt}"
`;
}

export type SanitizedAiGraphResult = {
  name: string;
  triggerType: TriggerType;
  triggerConfig: unknown;
  graph: AutomationGraph;
  explanation: string;
  issues: GraphIssue[];
};

/**
 * Higieniza, repara e valida um grafo de automação gerado por IA:
 * 1. Remove arestas desconexas, auto-loops e saídas ilegais de blocos terminais;
 * 2. Garante a existência do nó trigger;
 * 3. Preserva saídas canônicas e corrige aliases conhecidos ou saídas inequívocas omitidas;
 * 4. Preenche fallbacks seguros para nós incompletos com catálogo real;
 * 5. Aplica auto-layout para posicionamento limpo dos nós no canvas;
 * 6. Executa validateGraph retornando o grafo pronto e os avisos encontrados.
 */
export function sanitizeAndValidateGeneratedGraph(
  raw: unknown,
  refs: GraphRefs,
): SanitizedAiGraphResult {
  let parsed: Record<string, unknown> = {};

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  } else if (typeof raw === "object" && raw !== null) {
    parsed = raw as Record<string, unknown>;
  }

  const name = typeof parsed.name === "string" && parsed.name.trim().length > 0
    ? parsed.name.trim().slice(0, 100)
    : "Automação com IA";

  const triggerType: TriggerType = (TRIGGER_TYPES as readonly string[]).includes(parsed.triggerType as string)
    ? (parsed.triggerType as TriggerType)
    : "message_received";

  const triggerConfig = typeof parsed.triggerConfig === "object" && parsed.triggerConfig !== null
    ? parsed.triggerConfig
    : { firstMessageOnly: false };

  const explanation = typeof parsed.explanation === "string" && parsed.explanation.trim().length > 0
    ? parsed.explanation.trim()
    : "Fluxo gerado e estruturado automaticamente.";

  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const cleanNodes: AutomationGraph["nodes"] = [];
  const seenIds = new Set<string>();
  let hasTrigger = false;

  for (let i = 0; i < rawNodes.length; i++) {
    const node = rawNodes[i];
    if (!node || typeof node !== "object") continue;

    const nodeType: NodeType = (NODE_TYPES as readonly string[]).includes((node as { type?: string }).type as string)
      ? ((node as { type: NodeType }).type)
      : "message";

    if (nodeType === "trigger") {
      if (hasTrigger) continue;
      hasTrigger = true;
    }

    let id = typeof (node as { id?: string }).id === "string" && (node as { id: string }).id.trim().length > 0
      ? (node as { id: string }).id.trim()
      : `${nodeType}_${i + 1}`;

    if (seenIds.has(id)) {
      id = `${id}_${i + 1}`;
    }
    seenIds.add(id);

    const config = typeof (node as { config?: unknown }).config === "object" && (node as { config?: unknown }).config !== null
      ? { ...((node as { config: Record<string, unknown> }).config) }
      : {};

    if (nodeType === "message") {
      config.mode = config.mode === "ai" ? "ai" : "text";
      if (config.mode === "text") {
        if (typeof config.text !== "string" || config.text.trim().length === 0) {
          config.text = "Olá! Como posso te ajudar hoje?";
        }
        if (Array.isArray(config.buttons)) {
          config.buttons = (config.buttons as Record<string, unknown>[]).slice(0, 3).map((b, bIdx) => {
            const bId = optionId.safeParse(b?.id).success
              ? b.id
              : `opt${bIdx + 1}`;
            const bTitle = typeof b?.title === "string" && b.title.trim().length > 0
              ? b.title.trim().slice(0, 20)
              : `Opção ${bIdx + 1}`;
            const bKind = b?.kind === "url" ? "url" : "path";
            return {
              id: bId,
              title: bTitle,
              kind: bKind,
              ...(bKind === "url" ? { url: typeof b.url === "string" ? b.url : "https://exemplo.com.br" } : {}),
            };
          });
        }
      }
    } else if (nodeType === "condition") {
      if (!config.kind) {
        config.kind = "keyword";
        config.keywords = ["sim"];
        config.mode = "contains";
      }
    } else if (nodeType === "delay") {
      const mins = typeof config.minutes === "number" ? Math.round(config.minutes) : 60;
      config.minutes = mins > 0 ? mins : 60;
    } else if (nodeType === "tag" || nodeType === "remove_tag") {
      if (!config.tagId && refs.tagIds.length > 0) {
        config.tagId = refs.tagIds[0];
      }
    } else if (nodeType === "move_stage") {
      if (!config.stageId && refs.stageIds.length > 0) {
        config.stageId = refs.stageIds[0];
      }
    } else if (nodeType === "sequence_enroll" || nodeType === "sequence_remove") {
      if (!config.sequenceId && refs.sequenceIds.length > 0) {
        config.sequenceId = refs.sequenceIds[0];
      }
    } else if (nodeType === "assign_user") {
      if (!config.userId && refs.userIds.length > 0) {
        config.userId = refs.userIds[0];
      }
    }

    cleanNodes.push({
      id,
      type: nodeType,
      config,
      position: { x: 0, y: 0 },
    });
  }

  let insertedTrigger = false;
  if (!hasTrigger) {
    const triggerId = seenIds.has("trigger") ? "trigger_root" : "trigger";
    cleanNodes.unshift({
      id: triggerId,
      type: "trigger",
      config: {},
      position: { x: 0, y: 0 },
    });
    seenIds.add(triggerId);
    hasTrigger = true;
    insertedTrigger = true;
  }

  const nodeMap = new Map(cleanNodes.map((n) => [n.id, n]));
  const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
  const cleanEdges: AutomationGraph["edges"] = [];
  const seenHandleKeys = new Set<string>();

  for (let i = 0; i < rawEdges.length; i++) {
    const edge = rawEdges[i];
    if (!edge || typeof edge !== "object") continue;

    const source = typeof (edge as { source?: string }).source === "string" ? (edge as { source: string }).source : "";
    const target = typeof (edge as { target?: string }).target === "string" ? (edge as { target: string }).target : "";

    if (!nodeMap.has(source) || !nodeMap.has(target)) continue;
    if (source === target) continue;

    const sourceNode = nodeMap.get(source)!;
    const validHandles = requiredHandles(sourceNode);
    if (validHandles.length === 0) continue;

    let sourceHandle = "default";
    const rawHandle = typeof (edge as { sourceHandle?: unknown }).sourceHandle === "string"
      ? (edge as { sourceHandle: string }).sourceHandle.trim()
      : "";

    // Corrige somente aliases conhecidos ou saída omitida e inequívoca.
    // Uma opção inexistente nunca pode ser reatribuída a outro caminho.
    if (sourceNode.type === "condition" && (rawHandle === "yes" || rawHandle === "no")) {
      sourceHandle = rawHandle === "yes" ? "true" : "false";
    } else if (!rawHandle && validHandles.length === 1) {
      sourceHandle = validHandles[0]!;
    } else {
      sourceHandle = rawHandle;
    }
    if (!HANDLE_REGEX.test(sourceHandle) || !validHandles.includes(sourceHandle)) continue;

    const handleKey = `${source}:${sourceHandle}`;
    if (seenHandleKeys.has(handleKey)) continue;
    seenHandleKeys.add(handleKey);

    cleanEdges.push({
      id: `e_${source}_${target}_${sourceHandle}_${i}`,
      source,
      target,
      sourceHandle,
    });
  }

  if (insertedTrigger && cleanNodes.length > 1) {
    const triggerNode = cleanNodes[0]!;
    const firstChild = cleanNodes[1]!;
    cleanEdges.unshift({
      id: `e_${triggerNode.id}_${firstChild.id}_default`,
      source: triggerNode.id,
      target: firstChild.id,
      sourceHandle: "default",
    });
  }

  const laidOutGraph = applyAutoLayout({
    nodes: cleanNodes,
    edges: cleanEdges,
  });

  const issues = validateGraph(
    laidOutGraph,
    { type: triggerType, config: triggerConfig },
    refs,
  );

  return {
    name,
    triggerType,
    triggerConfig,
    graph: laidOutGraph,
    explanation,
    issues,
  };
}

