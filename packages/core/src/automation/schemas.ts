import { z } from "zod";

export const TRIGGER_TYPES = [
  "message_received",
  "keyword_detected",
  "instagram_comment",
  "instagram_story",
  "contact_created",
  "tag_added",
  "stage_changed",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export const NODE_TYPES = [
  "trigger",
  "message",
  "condition",
  "delay",
  "tag",
  "remove_tag",
  "assign_user",
  "move_stage",
  "webhook",
  "close_conversation",
  "handoff_ai",
  "handoff_human",
  "end",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

const keywordModeSchema = z.enum(["contains", "equals", "starts_with"]);
const keywordsSchema = z
  .array(z.string().trim().min(1, "Informe a palavra-chave.").max(100, "Máximo de 100 caracteres por palavra-chave."))
  .min(1, "Informe ao menos uma palavra-chave.")
  .max(20, "Máximo de 20 palavras-chave.");
const uuid = z.string().uuid("Identificador inválido.");
const httpsUrl = z
  .string()
  .trim()
  .max(2000, "URL muito longa.")
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use uma URL https válida.");

export const triggerConfigSchemas: Record<TriggerType, z.ZodType> = {
  message_received: z.object({ firstMessageOnly: z.boolean() }),
  keyword_detected: z.object({ keywords: keywordsSchema, mode: keywordModeSchema }),
  instagram_comment: z.object({
    channelId: uuid,
    mediaId: z.string().min(1).nullable(),
    keywords: keywordsSchema,
    mode: keywordModeSchema,
  }),
  instagram_story: z.object({ channelId: uuid }),
  contact_created: z.object({}),
  tag_added: z.object({ tagId: uuid.nullable() }),
  stage_changed: z.object({ stageId: uuid.nullable() }),
};

const optionId = z.string().regex(/^[a-z0-9]{1,12}$/, "Use de 1 a 12 letras minúsculas ou números.");
const optionTitle = z.string().min(1, "Informe o título.").max(20, "O título deve ter no máximo 20 caracteres.");

const buttonSchema = z
  .object({
    id: optionId,
    title: optionTitle,
    kind: z.enum(["path", "url"]),
    url: httpsUrl.optional(),
  })
  .superRefine((b, ctx) => {
    if (b.kind === "url" && !b.url) ctx.addIssue({ code: "custom", path: ["url"], message: "Informe a URL do botão." });
  });
const quickReplySchema = z.object({ id: optionId, title: optionTitle });

const textMessageSchema = z
  .object({
    mode: z.literal("text"),
    text: z.string().min(1, "Informe a mensagem.").max(4096, "A mensagem deve ter no máximo 4096 caracteres."),
    buttons: z.array(buttonSchema).max(3, "Máximo de 3 botões.").optional(),
    quickReplies: z.array(quickReplySchema).max(13, "Máximo de 13 respostas rápidas.").optional(),
    replyTimeoutHours: z.number().int().min(1).max(168).default(24),
  })
  .superRefine((m, ctx) => {
    if (m.buttons?.length && m.quickReplies?.length) {
      ctx.addIssue({ code: "custom", path: ["quickReplies"], message: "Use botões ou respostas rápidas, não os dois." });
    }
    const ids = [...(m.buttons ?? []), ...(m.quickReplies ?? [])].map((o) => o.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["buttons"], message: "Os identificadores das opções devem ser únicos." });
    }
  });

const messageSchema = z.discriminatedUnion("mode", [textMessageSchema, z.object({ mode: z.literal("ai") })]);

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use o formato HH:MM.");

const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("keyword"), keywords: keywordsSchema, mode: keywordModeSchema }),
  z.object({ kind: z.literal("has_tag"), tagId: uuid }),
  z.object({ kind: z.literal("stage_is"), stageId: uuid }),
  z.object({ kind: z.literal("lead_score_gte"), value: z.number().int().min(0).max(100) }),
  z.object({ kind: z.literal("intent_is"), intent: z.string().trim().min(1).max(100) }),
  z.object({
    kind: z.literal("business_hours"),
    days: z.array(z.number().int().min(1).max(7)).min(1, "Escolha ao menos um dia."),
    start: hhmm,
    end: hhmm,
  }),
]);

export const nodeConfigSchemas: Record<NodeType, z.ZodType> = {
  trigger: z.object({}).passthrough(),
  message: messageSchema,
  condition: conditionSchema,
  delay: z.object({
    minutes: z.number().int().min(1, "A espera mínima é 1 minuto.").max(10080, "A espera máxima é 7 dias."),
  }),
  tag: z.object({ tagId: uuid }),
  remove_tag: z.object({ tagId: uuid }),
  assign_user: z.object({ userId: uuid }),
  move_stage: z.object({ stageId: uuid }),
  webhook: z.object({ url: httpsUrl }),
  close_conversation: z.object({}),
  handoff_ai: z.object({}),
  handoff_human: z.object({}),
  end: z.object({}),
};

export const HANDLE_REGEX = /^(default|true|false|no_reply|sent|handoff|opt:[a-z0-9]{1,12})$/;

export const automationGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string().min(1).max(64),
      type: z.enum(NODE_TYPES),
      config: z.unknown(),
      position: z.object({ x: z.number(), y: z.number() }),
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string().min(1).max(64),
      source: z.string().min(1).max(64),
      target: z.string().min(1).max(64),
      sourceHandle: z.string().regex(HANDLE_REGEX, "Saída inválida."),
    }),
  ),
});
export type AutomationGraph = z.infer<typeof automationGraphSchema>;
