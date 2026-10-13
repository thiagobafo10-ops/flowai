import { z } from "zod";

export const classificationSchema = z.object({
  intent: z.string().min(1).max(100),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  lead_score: z.number().int().min(0).max(100),
  needs_human: z.boolean(),
  summary: z.string().max(500),
  suggested_stage: z.string().nullable(),
});

export const replyOutputSchema = z.object({
  reply: z.string().max(2000),
  used_chunk_ids: z.array(z.string()),
  needs_human: z.boolean(),
  handoff_reason: z.string().max(200).nullable(),
});

export const agentConfigSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do agente.").max(100, "O nome deve ter no máximo 100 caracteres."),
  personality: z.string().max(2000, "A personalidade deve ter no máximo 2000 caracteres."),
  objective: z.string().max(2000, "O objetivo deve ter no máximo 2000 caracteres."),
  tone: z.string().trim().min(1, "Informe o tom de voz.").max(100, "O tom deve ter no máximo 100 caracteres."),
  systemPrompt: z.string().max(8000, "O prompt deve ter no máximo 8000 caracteres."),
  isActive: z.boolean(),
  autoReply: z.boolean(),
  humanHandoff: z.boolean(),
});

export const knowledgeDocumentSchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(200, "O título deve ter no máximo 200 caracteres."),
  content: z
    .string()
    .refine((v) => v.trim().length > 0, "O conteúdo não pode ficar vazio.")
    .refine((v) => v.length <= 200000, "O conteúdo deve ter no máximo 200000 caracteres."),
});

export const playgroundInputSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["contact", "ai"]),
        text: z
          .string()
          .min(1)
          .max(1000, "Cada mensagem deve ter no máximo 1000 caracteres.")
          .refine((v) => v.trim().length > 0, "A mensagem não pode ficar vazia."),
      }),
    )
    .min(1, "Envie ao menos uma mensagem.")
    .max(10, "Envie no máximo 10 mensagens.")
    .refine((m) => m[m.length - 1]?.role === "contact", "A última mensagem deve ser do contato."),
});

export type Classification = z.infer<typeof classificationSchema>;
export type ReplyOutput = z.infer<typeof replyOutputSchema>;
export type AgentConfigInput = z.output<typeof agentConfigSchema>;
export type KnowledgeDocumentInput = z.output<typeof knowledgeDocumentSchema>;
export type PlaygroundInput = z.output<typeof playgroundInputSchema>;
