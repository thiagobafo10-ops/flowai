import type { StoreItem } from "../store/yampi.ts";

export type EmailContent = { subject: string; heading: string; body: string; buttonLabel: string; coupon: string | null };
export type EmailContext = {
  storeName: string; firstName: string | null; name: string | null; total: number | null;
  items: StoreItem[]; buttonUrl: string; unsubscribeUrl: string | null;
};

const INK = "#0E0E0E", BG = "#F4F2EE", ACCENT = "#E8458B";
const SERIF = "Georgia, 'Times New Roman', serif", SANS = "Arial, Helvetica, sans-serif";
const MAX_ITEMS = 4;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n).replace(/\s/g, " ");

export function fillVariables(text: string, ctx: EmailContext & { coupon: string | null }): string {
  const vars: Record<string, string> = {
    primeiro_nome: ctx.firstName ?? "", nome: ctx.name ?? "", loja: ctx.storeName,
    cupom: ctx.coupon ?? "", valor: ctx.total == null ? "" : brl(ctx.total),
  };
  let out = text;
  let capitalize = false;
  for (const [k, v] of Object.entries(vars)) {
    if (v) { out = out.split(`{${k}}`).join(v); continue; }
    if (out.trimStart().startsWith(`{${k}}`)) capitalize = true;
    // empty value: drop the variable plus an orphan comma/space (before it, else after it)
    out = out.replace(new RegExp(String.raw`,\s*\{${k}\}`, "g"), "").replace(new RegExp(String.raw`\{${k}\}\s*,?\s*`, "g"), "");
  }
  out = out.trim();
  return capitalize ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

function itemsHtml(items: StoreItem[]): string {
  if (!items.length) return "";
  const rows = items.slice(0, MAX_ITEMS).map((i) => {
    const img = i.imageUrl ? `<img src="${esc(i.imageUrl)}" alt="${esc(i.name)}" width="64" style="display:block;border:0;" />` : "";
    const variant = i.variant ? `<div style="font-size:12px;color:#6B6B6B;">${esc(i.variant)}</div>` : "";
    return `<tr><td width="72" style="padding:8px 0;">${img}</td><td style="padding:8px 0;font-family:${SANS};font-size:14px;color:${INK};">${esc(i.name)}${variant}</td><td align="right" style="padding:8px 0;font-family:${SANS};font-size:14px;color:${INK};">${i.quantity}x</td></tr>`;
  }).join("");
  const more = items.length - MAX_ITEMS;
  const moreRow = more > 0
    ? `<tr><td colspan="3" style="padding:8px 0;font-family:${SANS};font-size:13px;color:#6B6B6B;">e mais ${more} ${more === 1 ? "item" : "itens"}</td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #DDD9D2;margin:24px 0 0;">${rows}${moreRow}</table>`;
}

export function renderEmail(content: EmailContent, ctx: EmailContext): { subject: string; html: string; text: string } {
  const coupon = content.coupon || null;
  const f = (s: string) => fillVariables(s, { ...ctx, coupon });
  const subject = f(content.subject), heading = f(content.heading), body = f(content.body), button = f(content.buttonLabel);

  const couponBox = coupon
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 0;"><tr><td align="center" style="border:2px dashed ${ACCENT};padding:16px;font-family:${SANS};"><div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6B6B6B;">Seu cupom</div><div style="font-family:${SERIF};font-size:24px;color:${INK};margin-top:4px;">${esc(coupon)}</div></td></tr></table>`
    : "";
  const unsub = ctx.unsubscribeUrl
    ? `<br /><a href="${esc(ctx.unsubscribeUrl)}" style="color:#6B6B6B;">Não quero mais receber estes e-mails</a>`
    : "";

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;">
<tr><td align="center" style="background:${INK};padding:20px;font-family:${SERIF};font-size:22px;color:${BG};">${esc(ctx.storeName)}</td></tr>
<tr><td style="padding:32px 32px 8px;">
<h1 style="margin:0 0 16px;font-family:${SERIF};font-size:26px;line-height:1.3;color:${INK};font-weight:normal;">${esc(heading)}</h1>
<p style="margin:0;font-family:${SANS};font-size:16px;line-height:1.6;color:${INK};white-space:pre-line;">${esc(body)}</p>
${itemsHtml(ctx.items)}${couponBox}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;"><tr><td style="background:${ACCENT};border-radius:4px;"><a href="${esc(ctx.buttonUrl)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${esc(button)}</a></td></tr></table>
</td></tr>
<tr><td style="padding:16px 32px 28px;border-top:1px solid #DDD9D2;font-family:${SANS};font-size:12px;line-height:1.6;color:#6B6B6B;">${esc(ctx.storeName)}${unsub}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [heading, body, coupon ? `Seu cupom: ${coupon}` : "", `${button}: ${ctx.buttonUrl}`,
    ctx.unsubscribeUrl ? `Não quero mais receber estes e-mails: ${ctx.unsubscribeUrl}` : ""]
    .filter(Boolean).join("\n\n");

  return { subject, html, text };
}

export const DEFAULT_CART_STEPS: readonly (EmailContent & { delayMinutes: number })[] = [
  { delayMinutes: 60, subject: "{primeiro_nome}, seu carrinho está guardado", heading: "{primeiro_nome}, deixamos seu carrinho guardado",
    body: "Você escolheu peças com carinho na {loja}. Elas continuam esperando por você, é só voltar e finalizar quando puder.",
    buttonLabel: "Finalizar minha compra", coupon: null },
  { delayMinutes: 1440, subject: "{primeiro_nome}, suas peças ainda estão aqui", heading: "{primeiro_nome}, ainda dá tempo",
    body: "Passando para lembrar que seu carrinho segue reservado na {loja}. Se ficou alguma dúvida, é só responder este e-mail.",
    buttonLabel: "Finalizar minha compra", coupon: null },
  { delayMinutes: 2880, subject: "{primeiro_nome}, um presente para finalizar sua compra", heading: "{primeiro_nome}, um presente para você",
    body: "Para ajudar você a concluir seu pedido, use o cupom {cupom} no checkout da {loja}. Que suas peças cheguem com bênção.",
    buttonLabel: "Finalizar minha compra", coupon: "" },
];
