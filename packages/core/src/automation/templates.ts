import type { TagColor } from "../crm/tag.ts";
import type { AutomationGraph, TriggerType } from "./schemas.ts";

/** Referências de espaço reservado (UUID v4 fixos); a camada web as troca ao instanciar o modelo. */
export const TEMPLATE_PLACEHOLDER = {
  channelId: "00000000-0000-4000-8000-0000000000c1",
  tagId: "00000000-0000-4000-8000-0000000000a1",
  tagId2: "00000000-0000-4000-8000-0000000000a2",
  stageId: "00000000-0000-4000-8000-0000000000b1",
} as const;

/** Marcadores de etiqueta disponíveis para um modelo. */
export type TemplateTagPlaceholder = "tagId" | "tagId2";

export type AutomationTemplate = {
  key: "comment_link" | "welcome_direct" | "qualify_buttons" | "group_invite";
  name: string;
  triggerType: TriggerType;
  triggerConfig: unknown;
  graph: AutomationGraph;
  /**
   * Etiquetas que o modelo precisa: a camada web cria as que faltarem e troca o
   * marcador pelo id real ao instanciar.
   */
  tagNames?: { placeholder: TemplateTagPlaceholder; name: string; color?: TagColor }[];
};

const pos = (x: number, y: number) => ({ x, y });

const commentLink: AutomationTemplate = {
  key: "comment_link",
  name: "Responder comentário com link",
  triggerType: "instagram_comment",
  triggerConfig: { channelId: TEMPLATE_PLACEHOLDER.channelId, mediaId: null, oncePerUser: true, keywords: ["quero"], mode: "contains" },
  graph: {
    nodes: [
      { id: "trigger", type: "trigger", config: {}, position: pos(0, 0) },
      {
        id: "ask",
        type: "message",
        config: {
          mode: "text",
          text: "Oi, {primeiro_nome}! Vi seu comentário. Quer receber o link no Direct?",
          buttons: [{ id: "quero", title: "Quero", kind: "path" }],
          replyTimeoutHours: 24,
        },
        position: pos(0, 140),
      },
      {
        id: "link",
        type: "message",
        config: {
          mode: "text",
          text: "Aqui está, {primeiro_nome}! Toque no botão para acessar.",
          // URL de exemplo: o editor/validador deve exigir que o admin a edite antes de ativar (a UI sinaliza).
          buttons: [{ id: "abrir", title: "Abrir link", kind: "url", url: "https://exemplo.com.br" }],
          replyTimeoutHours: 24,
        },
        position: pos(-120, 300),
      },
      { id: "end_link", type: "end", config: {}, position: pos(-120, 460) },
      { id: "end_silent", type: "end", config: {}, position: pos(160, 300) },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "ask", sourceHandle: "default" },
      { id: "e2", source: "ask", target: "link", sourceHandle: "opt:quero" },
      { id: "e3", source: "ask", target: "end_silent", sourceHandle: "no_reply" },
      { id: "e4", source: "link", target: "end_link", sourceHandle: "default" },
    ],
  },
};

const welcomeDirect: AutomationTemplate = {
  key: "welcome_direct",
  name: "Boas-vindas no Direct",
  triggerType: "message_received",
  triggerConfig: { firstMessageOnly: true },
  graph: {
    nodes: [
      { id: "trigger", type: "trigger", config: {}, position: pos(0, 0) },
      {
        id: "welcome",
        type: "message",
        config: { mode: "text", text: "Olá, {primeiro_nome}! Obrigado por entrar em contato. Já vamos te atender.", replyTimeoutHours: 24 },
        position: pos(0, 140),
      },
      { id: "end", type: "end", config: {}, position: pos(0, 280) },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "welcome", sourceHandle: "default" },
      { id: "e2", source: "welcome", target: "end", sourceHandle: "default" },
    ],
  },
};

const qualifyButtons: AutomationTemplate = {
  key: "qualify_buttons",
  name: "Qualificar lead com botões",
  triggerType: "keyword_detected",
  triggerConfig: { keywords: ["orçamento"], mode: "contains" },
  graph: {
    nodes: [
      { id: "trigger", type: "trigger", config: {}, position: pos(0, 0) },
      {
        id: "ask",
        type: "message",
        config: {
          mode: "text",
          text: "{primeiro_nome}, você quer receber um orçamento agora?",
          quickReplies: [
            { id: "sim", title: "Sim" },
            { id: "nao", title: "Ainda não" },
          ],
          replyTimeoutHours: 24,
        },
        position: pos(0, 140),
      },
      { id: "tag", type: "tag", config: { tagId: TEMPLATE_PLACEHOLDER.tagId }, position: pos(-160, 300) },
      { id: "stage", type: "move_stage", config: { stageId: TEMPLATE_PLACEHOLDER.stageId }, position: pos(-160, 440) },
      // Transferência é terminal (sem saída): a execução termina aqui.
      { id: "handoff", type: "handoff_human", config: {}, position: pos(-160, 580) },
      { id: "end_later", type: "end", config: {}, position: pos(0, 300) },
      { id: "end_silent", type: "end", config: {}, position: pos(160, 300) },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "ask", sourceHandle: "default" },
      { id: "e2", source: "ask", target: "tag", sourceHandle: "opt:sim" },
      { id: "e3", source: "ask", target: "end_later", sourceHandle: "opt:nao" },
      { id: "e4", source: "ask", target: "end_silent", sourceHandle: "no_reply" },
      { id: "e5", source: "tag", target: "stage", sourceHandle: "default" },
      { id: "e6", source: "stage", target: "handoff", sourceHandle: "default" },
    ],
  },
};

/**
 * Convite ao grupo: o botão é do tipo caminho, então o clique é rastreado.
 * Quem não clica dentro do prazo recebe a etiqueta de não clique, que serve
 * de público para a campanha de reengajamento.
 */
const groupInvite: AutomationTemplate = {
  key: "group_invite",
  name: "Convite ao grupo",
  triggerType: "instagram_comment",
  triggerConfig: { channelId: TEMPLATE_PLACEHOLDER.channelId, mediaId: null, oncePerUser: true, keywords: ["grupo"], mode: "contains" },
  tagNames: [
    { placeholder: "tagId", name: "Entrou no grupo", color: "green" },
    { placeholder: "tagId2", name: "Não clicou no grupo", color: "amber" },
  ],
  graph: {
    nodes: [
      { id: "trigger", type: "trigger", config: {}, position: pos(0, 0) },
      {
        id: "ask",
        type: "message",
        config: {
          mode: "text",
          text: "Oi, {primeiro_nome}! Quer entrar no nosso grupo? Toque no botão abaixo.",
          buttons: [{ id: "entrar", title: "Entrar no grupo", kind: "path" }],
          replyTimeoutHours: 24,
        },
        position: pos(0, 140),
      },
      { id: "tag_entered", type: "tag", config: { tagId: TEMPLATE_PLACEHOLDER.tagId }, position: pos(-160, 300) },
      {
        id: "link",
        type: "message",
        config: {
          mode: "text",
          text: "Ótimo, {primeiro_nome}! Aqui está o convite do grupo:",
          // URL de exemplo: o editor/validador exige que o admin a edite antes de ativar.
          buttons: [{ id: "abrir", title: "Abrir convite", kind: "url", url: "https://exemplo.com.br" }],
          replyTimeoutHours: 24,
        },
        position: pos(-160, 440),
      },
      { id: "tag_missed", type: "tag", config: { tagId: TEMPLATE_PLACEHOLDER.tagId2 }, position: pos(160, 300) },
      { id: "end_entered", type: "end", config: {}, position: pos(-160, 580) },
      { id: "end_missed", type: "end", config: {}, position: pos(160, 440) },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "ask", sourceHandle: "default" },
      { id: "e2", source: "ask", target: "tag_entered", sourceHandle: "opt:entrar" },
      { id: "e3", source: "ask", target: "tag_missed", sourceHandle: "no_reply" },
      { id: "e4", source: "tag_entered", target: "link", sourceHandle: "default" },
      { id: "e5", source: "link", target: "end_entered", sourceHandle: "default" },
      { id: "e6", source: "tag_missed", target: "end_missed", sourceHandle: "default" },
    ],
  },
};

export const automationTemplates: AutomationTemplate[] = [commentLink, welcomeDirect, qualifyButtons, groupInvite];
