export type OutboundButtons = {
  buttons?: { id: string; title: string; kind: "path" | "url"; url?: string }[];
  quickReplies?: { id: string; title: string }[];
  /** optionId → signed payload (built in SQL) */
  payloads: Record<string, string>;
};

function payloadFor(opts: OutboundButtons, id: string): string {
  const payload = opts.payloads[id];
  if (!payload) throw new Error("Missing payload for option");
  return payload;
}

/** Monta o corpo `message` da Send API do Instagram (texto, respostas rápidas ou botões). */
export function toInstagramMessage(text: string, opts: OutboundButtons): Record<string, unknown> {
  if (opts.quickReplies?.length) {
    return {
      text,
      quick_replies: opts.quickReplies.map((q) => ({ content_type: "text", title: q.title, payload: payloadFor(opts, q.id) })),
    };
  }
  if (opts.buttons?.length) {
    return {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text,
          buttons: opts.buttons.map((b) => {
            if (b.kind === "url") {
              if (!b.url) throw new Error("Missing url for url button");
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
