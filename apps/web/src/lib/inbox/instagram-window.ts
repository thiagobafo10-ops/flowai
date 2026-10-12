/** Instagram só permite responder até 24h após a última mensagem recebida do contato. */
export const INSTAGRAM_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INSTAGRAM_WINDOW_CLOSED =
  "A janela de 24 horas do Instagram expirou. Aguarde uma nova mensagem do contato para responder.";

/** Verdadeiro quando a janela está aberta em `now` (sem mensagem recebida, está fechada). */
export function isInstagramWindowOpen(lastInboundAt: string | null, now: Date): boolean {
  if (!lastInboundAt) return false;
  const at = Date.parse(lastInboundAt);
  return Number.isFinite(at) && now.getTime() - at < INSTAGRAM_WINDOW_MS;
}
