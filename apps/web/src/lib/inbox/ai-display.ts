import { HANDOFF_LABELS, type ConversationHandoffReason } from "@flowai/core";

const SENTIMENT_LABELS: Record<string, string> = { positive: "Positivo", neutral: "Neutro", negative: "Negativo" };

export function sentimentLabel(sentiment: string | null): string | null {
  return sentiment === null ? null : SENTIMENT_LABELS[sentiment] ?? sentiment;
}

/** Texto do aviso de transferência; código desconhecido aparece como veio. A automação tem texto próprio. */
export function handoffBannerText(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === "automation") return HANDOFF_LABELS.automation;
  return `Transferida pela IA: ${HANDOFF_LABELS[reason as ConversationHandoffReason] ?? reason}`;
}

export function canReturnToAi(c: { canWrite: boolean; status: "open" | "pending_human" | "closed"; handledBy: "ai" | "human" }): boolean {
  return c.canWrite && c.status !== "closed" && c.handledBy === "human";
}
