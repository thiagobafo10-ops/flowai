import { z } from "zod";
import { hhmm, httpsUrl, optionId, optionTitle } from "../automation/schemas.ts";

const uuid = z.string().uuid("Identificador inválido.");

export const LINK_CODE_REGEX = /^[a-z0-9_-]{3,40}$/;

export const entryLinkInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(100, "O nome deve ter no máximo 100 caracteres."),
  channelId: uuid,
  code: z.string().regex(LINK_CODE_REGEX, "Use de 3 a 40 letras minúsculas, números, hífen ou sublinhado.").optional(),
  tagId: uuid.nullable(),
});
export type EntryLinkInput = z.infer<typeof entryLinkInputSchema>;

const buttonSchema = z
  .object({
    id: optionId,
    title: optionTitle,
    kind: z.enum(["url", "automation"]),
    url: httpsUrl.optional(),
    automationId: uuid.optional(),
  })
  .superRefine((b, ctx) => {
    if (b.kind === "url" && !b.url) ctx.addIssue({ code: "custom", path: ["url"], message: "Informe a URL do botão." });
    if (b.kind === "automation" && !b.automationId) {
      ctx.addIssue({ code: "custom", path: ["automationId"], message: "Escolha a automação do botão." });
    }
  });
const quickReplySchema = z.object({ id: optionId, title: optionTitle, automationId: uuid });

export const outreachMessageSchema = z
  .object({
    text: z.string().min(1, "Informe a mensagem.").max(4096, "A mensagem deve ter no máximo 4096 caracteres."),
    buttons: z.array(buttonSchema).max(3, "Máximo de 3 botões.").optional(),
    quickReplies: z.array(quickReplySchema).max(13, "Máximo de 13 respostas rápidas.").optional(),
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
export type OutreachMessage = z.infer<typeof outreachMessageSchema>;

export const sendWindowSchema = z
  .object({
    days: z.array(z.number().int().min(1).max(7)).min(1, "Escolha ao menos um dia."),
    start: hhmm,
    end: hhmm,
  })
  .superRefine((v, ctx) => {
    if (new Set(v.days).size !== v.days.length) {
      ctx.addIssue({ code: "custom", path: ["days"], message: "Os dias não podem se repetir." });
    }
    if (v.start >= v.end) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "O horário final deve ser depois do inicial." });
    }
  });
export type SendWindow = z.infer<typeof sendWindowSchema>;

export const sequenceStepSchema = z.object({
  delayMinutes: z.number().int().min(1, "A espera mínima é 1 minuto.").max(43200, "A espera máxima é 30 dias."),
  window: sendWindowSchema.nullable(),
  message: outreachMessageSchema,
});
export type SequenceStep = z.infer<typeof sequenceStepSchema>;

export const DEFAULT_EXIT_WORDS = ["sair", "parar", "cancelar"];

export const sequenceSettingsSchema = z.object({
  channelIds: z.array(uuid).min(1, "Escolha ao menos um canal."),
  exitOnReply: z.boolean().default(false),
  exitWords: z
    .array(z.string().trim().min(1, "Informe a palavra.").max(30, "Máximo de 30 caracteres por palavra."))
    .default(() => [...DEFAULT_EXIT_WORDS]),
});
export type SequenceSettings = z.infer<typeof sequenceSettingsSchema>;

export const audienceFilterSchema = z.object({
  channelIds: z.array(uuid).min(1, "Escolha ao menos um canal."),
  tagsAll: z.array(uuid),
  tagsAny: z.array(uuid),
  tagsNone: z.array(uuid),
  stageIds: z.array(uuid),
  minLeadScore: z.number().int().min(0).max(100).nullable(),
  lastInteractionDays: z.number().int().min(1).max(365).nullable(),
  entryLinkIds: z.array(uuid),
});
export type AudienceFilter = z.infer<typeof audienceFilterSchema>;
