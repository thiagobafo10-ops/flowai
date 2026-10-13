import { HANDOFF_LABELS, type HandoffReason } from "@flowai/core";

const SENTIMENT_LABELS: Record<string, string> = { positive: "Positivo", neutral: "Neutro", negative: "Negativo" };

export function sentimentLabel(sentiment: string | null): string | null {
  return sentiment === null ? null : SENTIMENT_LABELS[sentiment] ?? sentiment;
}

/** Texto do aviso de transferência; código desconhecido aparece como veio. */
export function handoffBannerText(reason: string | null): string | null {
  if (!reason) return null;
  return `Transferida pela IA: ${HANDOFF_LABELS[reason as HandoffReason] ?? reason}`;
}

export function canReturnToAi(c: { canWrite: boolean; status: "open" | "pending_human" | "closed"; handledBy: "ai" | "human" }): boolean {
  return c.canWrite && c.status !== "closed" && c.handledBy === "human";
}
