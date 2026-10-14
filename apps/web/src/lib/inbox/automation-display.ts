/** Exibição de automações no Inbox: botões/respostas rápidas das mensagens e aviso do cabeçalho. */

export const AUTOMATION_BUTTON_GONE = "Este botão não está mais disponível.";
export const AUTOMATION_SIMULATOR_ONLY = "Só é possível clicar nos botões em conversas do Simulador.";

const ACTIVE_RUN_STATUSES = ["pending", "running", "waiting"];

/** Execução ligada à conversa (conversations.automation_run_id) com o nome da automação. */
export type ConversationAutomation = { runId: string; status: string; name: string };

export type RenderedOption = { id: string; title: string; mode: "click" | "link" | "readonly"; url?: string };

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isObject) : []);
const option = (o: Raw) => (typeof o.id === "string" && typeof o.title === "string" ? { id: o.id, title: o.title } : null);

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Opções a exibir sob a bolha de uma mensagem da automação (context.automation). Botões de caminho e
 * respostas rápidas só são clicáveis por agent+ em conversas do Simulador; links abrem em nova aba.
 */
export function automationOptions(
  message: { senderType: string; context?: unknown },
  opts: { canWrite: boolean; channelType: string },
): RenderedOption[] {
  if (message.senderType !== "automation" || !isObject(message.context) || !isObject(message.context.automation)) return [];
  const automation = message.context.automation;
  const clickable = opts.canWrite && opts.channelType === "simulator";
  const out: RenderedOption[] = [];
  for (const b of list(automation.buttons)) {
    const base = option(b);
    if (!base) continue;
    if (b.kind === "url") {
      const url = safeUrl(b.url);
      out.push(url ? { ...base, mode: "link", url } : { ...base, mode: "readonly" });
    } else {
      out.push({ ...base, mode: clickable ? "click" : "readonly" });
    }
  }
  for (const q of list(automation.quickReplies)) {
    const base = option(q);
    if (base) out.push({ ...base, mode: clickable ? "click" : "readonly" });
  }
  return out;
}

const isActive = (run: ConversationAutomation | null): run is ConversationAutomation =>
  run !== null && ACTIVE_RUN_STATUSES.includes(run.status);

/** `Em automação: {nome}` enquanto a execução ligada à conversa está ativa. */
export function automationBanner(run: ConversationAutomation | null): string | null {
  return isActive(run) ? `Em automação: ${run.name}` : null;
}

export function canStopAutomation(c: { canWrite: boolean; run: ConversationAutomation | null }): boolean {
  return c.canWrite && isActive(c.run);
}
