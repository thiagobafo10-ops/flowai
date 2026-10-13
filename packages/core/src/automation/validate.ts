import {
  nodeConfigSchemas,
  triggerConfigSchemas,
  type AutomationGraph,
  type NodeType,
  type TriggerType,
} from "./schemas.ts";

export type GraphRefs = { tagIds: string[]; stageIds: string[]; userIds: string[]; channelIds: string[] };
export type GraphIssue = { nodeId: string | null; code: string; message: string };

type GraphNode = AutomationGraph["nodes"][number];

const INSTAGRAM_MAX_BYTES = 1000;
const INSTAGRAM_TRIGGERS: TriggerType[] = ["instagram_comment", "instagram_story"];

const NODE_LABELS: Record<NodeType, string> = {
  trigger: "Gatilho",
  message: "Mensagem",
  condition: "Condição",
  delay: "Espera",
  tag: "Adicionar etiqueta",
  remove_tag: "Remover etiqueta",
  assign_user: "Atribuir responsável",
  move_stage: "Mover etapa",
  webhook: "Webhook",
  close_conversation: "Encerrar conversa",
  handoff_ai: "Transferir para IA",
  handoff_human: "Transferir para humano",
  end: "Fim",
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Lê opções de uma mensagem de texto sem exigir que a config inteira seja válida. */
function messageOptions(config: unknown): { text: string | null; pathIds: string[]; quickIds: string[] } | null {
  if (!isRecord(config) || config.mode !== "text") return null;
  const ids = (list: unknown, only?: (o: Record<string, unknown>) => boolean): string[] =>
    Array.isArray(list)
      ? list
          .filter((o): o is Record<string, unknown> => isRecord(o) && typeof o.id === "string" && (!only || only(o)))
          .map((o) => o.id as string)
      : [];
  return {
    text: typeof config.text === "string" ? config.text : null,
    pathIds: ids(config.buttons, (o) => o.kind === "path"),
    quickIds: ids(config.quickReplies),
  };
}

export function requiredHandles(node: GraphNode): string[] {
  if (node.type === "condition") return ["true", "false"];
  if (node.type === "end") return [];
  if (node.type === "message") {
    if (isRecord(node.config) && node.config.mode === "ai") return ["sent", "handoff"];
    const opts = messageOptions(node.config);
    const ids = opts ? [...opts.pathIds, ...opts.quickIds] : [];
    return ids.length ? [...ids.map((id) => `opt:${id}`), "no_reply"] : ["default"];
  }
  return ["default"];
}

function hasOptions(node: GraphNode): boolean {
  const opts = messageOptions(node.config);
  return !!opts && opts.pathIds.length + opts.quickIds.length > 0;
}

function zodMessage(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.map((i) => i.message).join(" ");
}

export function validateGraph(
  graph: AutomationGraph,
  trigger: { type: TriggerType; config: unknown },
  refs: GraphRefs,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const add = (nodeId: string | null, code: string, message: string) => issues.push({ nodeId, code, message });
  const label = (n: GraphNode) => NODE_LABELS[n.type];

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const triggers = graph.nodes.filter((n) => n.type === "trigger");
  if (triggers.length === 0) add(null, "no_trigger", "A automação precisa de um gatilho.");
  for (const extra of triggers.slice(1)) {
    add(extra.id, "multiple_triggers", "A automação deve ter apenas um gatilho.");
  }
  const triggerNodeId = triggers.length === 1 ? triggers[0]!.id : null;

  // Arestas
  const outgoing = new Map<string, typeof graph.edges>();
  for (const e of graph.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) {
      add(byId.has(e.source) ? e.source : null, "dangling_edge", "Há uma conexão que aponta para um passo inexistente.");
      continue;
    }
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
  }

  // Uma saída só pode ter uma ligação
  for (const [id, list] of outgoing) {
    const n = byId.get(id)!;
    const counts = new Map<string, number>();
    for (const e of list) counts.set(e.sourceHandle, (counts.get(e.sourceHandle) ?? 0) + 1);
    for (const [h, c] of counts) {
      if (c > 1) add(id, "duplicate_handle", `Cada saída só pode ter uma ligação ("${label(n)}", saída "${h}").`);
    }
  }

  // Ligações que partem de uma saída (ignora arestas pendentes)
  const targetsOf = (id: string, handles?: string[]) =>
    (outgoing.get(id) ?? []).filter((e) => !handles || handles.includes(e.sourceHandle)).map((e) => e.target);

  /** BFS compartilhado: nós alcançados a partir de `starts` (inclusive). Em nós com `stopAt` verdadeiro, não expande as saídas. */
  const walk = (starts: string[], stopAt?: (n: GraphNode) => boolean): Set<string> => {
    const seen = new Set(starts);
    const queue = [...starts];
    while (queue.length) {
      const id = queue.shift()!;
      if (stopAt?.(byId.get(id)!)) continue;
      for (const t of targetsOf(id)) {
        if (!seen.has(t)) {
          seen.add(t);
          queue.push(t);
        }
      }
    }
    return seen;
  };

  // Alcançabilidade (a partir dos gatilhos)
  if (triggers.length > 0) {
    const seen = walk(triggers.map((t) => t.id));
    for (const n of graph.nodes) {
      if (!seen.has(n.id)) add(n.id, "unreachable", `O passo "${label(n)}" não é alcançado a partir do gatilho.`);
    }
  }

  // Ciclos (DFS)
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of outgoing.get(id) ?? []) {
      const s = state.get(e.target);
      if (s === 1) add(e.target, "cycle", `Há um ciclo no fluxo passando por "${label(byId.get(e.target)!)}".`);
      else if (!s) visit(e.target);
    }
    state.set(id, 2);
  };
  for (const n of graph.nodes) if (!state.has(n.id)) visit(n.id);

  // Saídas
  for (const n of graph.nodes) {
    const required = requiredHandles(n);
    const used = new Set((outgoing.get(n.id) ?? []).map((e) => e.sourceHandle));
    for (const h of required) {
      if (!used.has(h)) add(n.id, "missing_handle", `O passo "${label(n)}" precisa de uma conexão na saída "${h}".`);
    }
    for (const h of used) {
      if (!required.includes(h)) add(n.id, "extra_handle", `O passo "${label(n)}" tem uma conexão na saída inexistente "${h}".`);
    }
  }

  // Configuração e referências
  const checkRef = (nodeId: string | null, kind: "tag" | "stage" | "user" | "channel", id: string | null | undefined) => {
    if (!id) return;
    const list = { tag: refs.tagIds, stage: refs.stageIds, user: refs.userIds, channel: refs.channelIds }[kind];
    if (list.includes(id)) return;
    const msg = {
      tag: "A etiqueta usada não existe mais.",
      stage: "A etapa usada não existe mais.",
      user: "O responsável usado não existe mais.",
      channel: "O canal usado não existe mais.",
    }[kind];
    add(nodeId, `unknown_${kind}`, msg);
  };

  const triggerParsed = triggerConfigSchemas[trigger.type].safeParse(trigger.config);
  if (!triggerParsed.success) {
    add(triggerNodeId, "invalid_config", `Gatilho: ${zodMessage(triggerParsed.error)}`);
  } else {
    const c = triggerParsed.data as { channelId?: string; tagId?: string | null; stageId?: string | null };
    if (trigger.type === "instagram_comment" || trigger.type === "instagram_story") checkRef(triggerNodeId, "channel", c.channelId);
    if (trigger.type === "tag_added") checkRef(triggerNodeId, "tag", c.tagId);
    if (trigger.type === "stage_changed") checkRef(triggerNodeId, "stage", c.stageId);
  }

  const instagram = INSTAGRAM_TRIGGERS.includes(trigger.type);
  const encoder = new TextEncoder();
  for (const n of graph.nodes) {
    const parsed = nodeConfigSchemas[n.type].safeParse(n.config);
    if (!parsed.success) {
      add(n.id, "invalid_config", `${label(n)}: ${zodMessage(parsed.error)}`);
      continue;
    }
    const c = parsed.data as Record<string, unknown>;
    switch (n.type) {
      case "tag":
      case "remove_tag":
        checkRef(n.id, "tag", c.tagId as string);
        break;
      case "move_stage":
        checkRef(n.id, "stage", c.stageId as string);
        break;
      case "assign_user":
        checkRef(n.id, "user", c.userId as string);
        break;
      case "condition":
        if (c.kind === "has_tag") checkRef(n.id, "tag", c.tagId as string);
        if (c.kind === "stage_is") checkRef(n.id, "stage", c.stageId as string);
        break;
      case "message":
        // Contagem sobre o texto bruto: variáveis ({nome}...) podem expandir no envio,
        // e o caminho de envio aplica o limite final sobre o texto renderizado.
        if (instagram && c.mode === "text" && encoder.encode(c.text as string).length > INSTAGRAM_MAX_BYTES) {
          add(n.id, "message_too_long_instagram", "A mensagem passa de 1000 bytes, o limite do Instagram. Encurte o texto.");
        }
        break;
    }
  }

  // Comentário (regra da Meta): a primeira mensagem de cada caminho é a resposta ao comentário. Se o cliente não
  // responder (no_reply, ou default quando não há opções), nada mais pode ser enviado: só ações e fim.
  if (trigger.type === "instagram_comment" && triggers.length > 0) {
    const firstIds = targetsOf(triggers[0]!.id, ["default"]);
    const first = firstIds.length === 1 ? byId.get(firstIds[0]!) : undefined;
    if (!first || first.type !== "message" || messageOptions(first.config) === null) {
      add(triggers[0]!.id, "comment_first_message", "Conecte o gatilho de comentário diretamente a uma mensagem de texto.");
    }
    const isMessage = (n: GraphNode) => n.type === "message";
    const firstMessages = [...walk(triggers.map((t) => t.id), isMessage)].map((id) => byId.get(id)!).filter(isMessage);
    for (const m of firstMessages) {
      const isText = messageOptions(m.config) !== null;
      const silentHandles = hasOptions(m) ? ["no_reply"] : ["default"];
      const reached = isText ? walk(targetsOf(m.id, silentHandles), isMessage) : new Set<string>();
      const sendsAfterSilence = [...reached].some((id) => isMessage(byId.get(id)!));
      if (!isText || sendsAfterSilence) {
        add(
          m.id,
          "comment_needs_reply",
          "Em automações de comentário, quando o cliente não responde a primeira mensagem, o fluxo só pode ter ações e terminar; não envie outra mensagem.",
        );
      }
    }
  }

  return issues;
}
