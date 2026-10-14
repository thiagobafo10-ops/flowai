import { z } from "zod";
import {
  NODE_TYPES,
  TRIGGER_TYPES,
  type AutomationGraph,
  type NodeType,
  type TriggerType,
} from "./schemas.ts";

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

DIRETRIZES FUNDAMENTAIS:
1. Responda em Português do Brasil (pt-BR).
2. O fluxo sempre DEVE começar por um nó com id "trigger" e type "trigger".
3. Conecte os nós de forma lógica e sequencial usando "edges" (source, target, sourceHandle).
4. Nós terminais ("end", "close_conversation", "handoff_ai", "handoff_human") NÃO devem ter arestas de saída.
5. Para blocos de "condition":
   - Devem ter saída com sourceHandle "true" (quando atende) e sourceHandle "false" (quando não atende).
6. Para blocos de "message":
   - Podem ter botões (máximo 3) ou respostas rápidas (máximo 13).
   - Se houver opções/botões, cada opção possui um id (ex: "opt1", "opt2") e as saídas correspondentes usam sourceHandle "opt:opt1", "opt:opt2".
   - Se for mensagem simples sem botões, a saída usa sourceHandle "default".
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
