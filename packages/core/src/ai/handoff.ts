import type { Classification, ReplyOutput } from "./schemas.ts";

export type HandoffReason =
  | "needs_human" | "no_knowledge" | "unverified_fact" | "injection" | "quota_exceeded"
  | "not_configured" | "ai_failure" | "window_closed" | "reply_too_long";

export const HANDOFF_LABELS: Record<HandoffReason, string> = {
  needs_human: "Cliente precisa de atendimento humano",
  no_knowledge: "IA sem informação na base de conhecimento",
  unverified_fact: "IA citou um valor que não está na base",
  injection: "Possível tentativa de manipulação da IA",
  quota_exceeded: "Limite diário da IA atingido",
  not_configured: "IA não configurada na plataforma",
  ai_failure: "Falha temporária da IA",
  window_closed: "Fora da janela de 24h do Instagram",
  reply_too_long: "Resposta da IA longa demais para o canal",
};

export type HandoffDecision = { handoff: false } | { handoff: true; reason: HandoffReason; detail?: string };

export function decideHandoff(input: {
  injection: boolean;
  classification: Classification | null;
  reply: ReplyOutput | null;
  hitCount: number;
  factCheck: { ok: boolean } | null;
  replyBytes?: number;
  maxReplyBytes?: number;
}): HandoffDecision {
  if (input.injection) return { handoff: true, reason: "injection" };
  if (input.classification?.needs_human) return { handoff: true, reason: "needs_human" };
  if (input.reply?.needs_human) {
    if (input.hitCount === 0) {
      const detail = input.reply.handoff_reason ?? undefined;
      return detail ? { handoff: true, reason: "no_knowledge", detail } : { handoff: true, reason: "no_knowledge" };
    }
    return { handoff: true, reason: "needs_human" };
  }
  // A blank reply cannot be sent: treat it as the model having nothing to say.
  if (input.reply && input.reply.reply.trim() === "") {
    return { handoff: true, reason: input.hitCount === 0 ? "no_knowledge" : "needs_human" };
  }
  const hasBytes = input.replyBytes !== undefined;
  if (hasBytes !== (input.maxReplyBytes !== undefined)) return { handoff: true, reason: "ai_failure" };
  if (hasBytes && input.replyBytes! > input.maxReplyBytes!) return { handoff: true, reason: "reply_too_long" };
  if (input.reply && !input.factCheck) return { handoff: true, reason: "ai_failure" };
  if (input.factCheck && !input.factCheck.ok) return { handoff: true, reason: "unverified_fact" };
  return { handoff: false };
}
