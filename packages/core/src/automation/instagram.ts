export type OutboundButtons = {
  buttons?: { id: string; title: string; kind: "path" | "url"; url?: string }[];
  quickReplies?: { id: string; title: string }[];
  /** optionId → signed payload (built in SQL) */
  payloads: Record<string, string>;
};

const MAX_BYTES = 1000;
/** Limite da Meta para o texto do template de botões (caracteres). */
export const INSTAGRAM_BUTTON_TEXT_MAX = 640;
const MAX_BUTTONS = 3;
const MAX_QUICK_REPLIES = 13;
const MAX_TITLE = 20;

/** Código fixo, sem texto da mensagem, para não vazar conteúdo em logs. */
function invalid(): never {
  throw new Error("invalid_content");
}

function payloadFor(opts: OutboundButtons, id: string): string {
  const payload = opts.payloads[id];
  if (typeof payload !== "string" || payload.length === 0) invalid();
  return payload;
}

function checkTitle(title: string): void {
  if (title.length < 1 || title.length > MAX_TITLE) invalid();
}

function isHttps(url: string | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Monta o corpo `message` da Send API do Instagram (texto, respostas rápidas ou botões), validando os limites. */
export function toInstagramMessage(text: string, opts: OutboundButtons): Record<string, unknown> {
  if (text.trim().length === 0 || new TextEncoder().encode(text).byteLength > MAX_BYTES) invalid();
  const quickReplies = opts.quickReplies ?? [];
  const buttons = opts.buttons ?? [];
  if (quickReplies.length && buttons.length) invalid();
  if (quickReplies.length) {
    if (quickReplies.length > MAX_QUICK_REPLIES) invalid();
    return {
      text,
      quick_replies: quickReplies.map((q) => {
        checkTitle(q.title);
        return { content_type: "text", title: q.title, payload: payloadFor(opts, q.id) };
      }),
    };
  }
  if (buttons.length) {
    if (buttons.length > MAX_BUTTONS || [...text].length > INSTAGRAM_BUTTON_TEXT_MAX) invalid();
    return {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text,
          buttons: buttons.map((b) => {
            checkTitle(b.title);
            if (b.kind === "url") {
              if (!isHttps(b.url)) invalid();
              return { type: "web_url", url: b.url, title: b.title };
            }
            return { type: "postback", title: b.title, payload: payloadFor(opts, b.id) };
          }),
        },
      },
    };
  }
  return { text };
}
