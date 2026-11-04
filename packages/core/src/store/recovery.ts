import { fillVariables } from "../email/template.ts";

/** Brazilian mobile only -> "+55DD9XXXXXXXX", else null. */
export function normalizeBrazilMobile(raw: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return /^[1-9][1-9]9\d{8}$/.test(d) ? `+55${d}` : null;
}

export function isAllowedCheckoutUrl(url: string | null, hosts: readonly string[]): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && hosts.includes(u.hostname);
  } catch {
    return false;
  }
}

export type WhatsappVars = {
  firstName: string | null; link: string; total: number | null; storeName: string;
  items: { name: string; quantity: number }[];
};

export function renderWhatsappMessage(template: string, v: WhatsappVars): string {
  const base = fillVariables(template, {
    storeName: v.storeName, firstName: v.firstName, name: null, total: v.total,
    items: [], buttonUrl: v.link, unsubscribeUrl: null, coupon: null,
  });
  const itens = v.items.map((i) => `${i.quantity}x ${i.name}`).join(", ");
  return base.split("{itens}").join(itens).split("{link}").join(v.link);
}

export function whatsappUrl(phoneE164: string, text: string): string {
  // não usar wa.me: o redirecionamento troca emojis fora do BMP (ex.: 🤍) por "�"
  return `https://api.whatsapp.com/send?phone=${phoneE164.replace(/\D/g, "")}&text=${encodeURIComponent(text)}`;
}

export const DEFAULT_WHATSAPP_TEMPLATE =
  "Oi, {primeiro_nome}! Aqui é da {loja}. Vi que você deixou algumas peças no carrinho e quis te ajudar a finalizar. Se tiver qualquer dúvida, é só me responder por aqui. Seu carrinho continua guardado neste link: {link}";

/** Yampi sends { date: "YYYY-MM-DD HH:mm:ss.ffffff", timezone: IANA } (wall-clock in that zone) -> UTC ISO. */
export function yampiDateToIso(d: { date: string; timezone: string }): string | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d+))?/.exec(d.date);
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, Math.floor(+(`0.${m[7] ?? "0"}`) * 1000));
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: d.timezone, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
    const offsetAt = (t: number) => {
      const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, +x.value]));
      return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(t / 1000) * 1000;
    };
    // two passes handle instants near a DST change
    let t = wall - offsetAt(wall);
    t = wall - offsetAt(t);
    return new Date(t).toISOString();
  } catch {
    return null; // unknown timezone
  }
}
