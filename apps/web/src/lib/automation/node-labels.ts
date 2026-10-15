import type { NodeType, TriggerType } from "@flowai/core";

export const NODE_LABEL: Record<NodeType, string> = {
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
  sequence_enroll: "Inscrever em sequência",
  sequence_remove: "Remover de sequência",
  end: "Fim",
};

/** Blocos que podem ser arrastados da paleta (o gatilho é fixo). */
export const PALETTE_TYPES: Exclude<NodeType, "trigger">[] = [
  "message",
  "condition",
  "delay",
  "tag",
  "remove_tag",
  "assign_user",
  "move_stage",
  "sequence_enroll",
  "sequence_remove",
  "webhook",
  "close_conversation",
  "handoff_ai",
  "handoff_human",
  "end",
];

export const KEYWORD_MODE_LABEL: Record<string, string> = {
  contains: "Contém",
  equals: "É igual a",
  starts_with: "Começa com",
  any: "Qualquer palavra ou comentário",
};

export const WEEKDAY_LABEL: Record<number, string> = { 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb", 7: "Dom" };

/** Configuração inicial de um bloco novo; campos obrigatórios em branco aparecem como problema até serem preenchidos. */
export function defaultNodeConfig(type: NodeType): unknown {
  switch (type) {
    case "message":
      return { mode: "text", text: "", replyTimeoutHours: 24 };
    case "condition":
      return { kind: "keyword", keywords: [], mode: "contains" };
    case "delay":
      return { minutes: 60 };
    case "tag":
    case "remove_tag":
      return { tagId: "" };
    case "sequence_enroll":
    case "sequence_remove":
      return { sequenceId: "" };
    case "assign_user":
      return { userId: "" };
    case "move_stage":
      return { stageId: "" };
    case "webhook":
      return { url: "" };
    default:
      return {};
  }
}

export function defaultTriggerConfig(type: TriggerType, firstChannelId: string | null): unknown {
  switch (type) {
    case "message_received":
      return { firstMessageOnly: false };
    case "keyword_detected":
      return { keywords: [], mode: "contains" };
    case "instagram_comment":
      return { channelId: firstChannelId ?? "", mediaId: null, keywords: [], mode: "contains" };
    case "instagram_story":
      return { channelId: firstChannelId ?? "" };
    case "contact_created":
      return {};
    case "tag_added":
      return { tagId: null };
    case "stage_changed":
      return { stageId: null };
    case "entry_link":
      return { linkIds: [] };
  }
}
