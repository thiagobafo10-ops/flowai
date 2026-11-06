import { z } from "zod";
import { normalizeBrazilMobile, yampiDateToIso } from "./recovery.ts";

export type StoreItem = { name: string; variant: string | null; quantity: number; price: number; imageUrl: string | null };
export type StoreCustomer = { email: string | null; name: string | null; phone: string | null };
export type YampiEvent =
  | { kind: "cart"; event: "cart.reminder"; merchantAlias: string; customer: StoreCustomer;
      cart: { externalId: string; token: string | null; total: number; shipping: number | null; recoveryUrl: string | null; abandonedAt: string | null; items: StoreItem[] } }
  | { kind: "order"; event: "order.created" | "order.paid" | "order.status.updated"; merchantAlias: string; customer: StoreCustomer;
      order: { externalId: string; number: string; statusAlias: string | null; paymentAlias: string | null; total: number;
               cartToken: string | null; paid: boolean; items: StoreItem[]; trackCode: string | null; trackUrl: string | null;
               publicUrl: string | null; paymentUrl: string | null; dueAt: string | null } }
  | { kind: "ignored"; event: string };

const ORDER_EVENTS = ["order.created", "order.paid", "order.status.updated"] as const;

const str = z.union([z.string(), z.number()]).nullish().transform((v) => (v == null || v === "" ? null : String(v)));
const num = z.coerce.number().catch(0);

const resourceSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  token: str,
  simulate_url: str,
  created_at: z.object({ date: z.string(), timezone: z.string() }).passthrough().nullish().catch(null),
  number: str,
  cart_token: str,
  track_code: str,
  track_url: str,
  public_url: str,
  reorder_url: str,
  transactions: z.object({
    data: z.array(z.object({
      billet_date: str,
      billet_url: str,
      status: str,
      payment: z.object({
        data: z.object({ alias: str, is_billet: z.boolean().nullish() }).passthrough().nullish(),
      }).passthrough().nullish(),
    }).passthrough()).nullish(),
  }).passthrough().nullish(),
  value_total: num.optional(),
  totalizers: z.object({ total: num, shipment: z.coerce.number().nullish().catch(null) }).passthrough().nullish(),
  status: z.object({ data: z.object({ alias: str }).passthrough().nullish() }).passthrough().nullish(),
  payments: z.array(z.object({ alias: str }).passthrough()).nullish(),
  customer: z.object({
    data: z.object({
      email: z.string().nullish(),
      name: z.string().nullish(),
      phone: z.object({ full_number: str }).passthrough().nullish(),
    }).passthrough().nullish(),
  }).passthrough().nullish(),
  items: z.object({
    data: z.array(z.object({
      quantity: num,
      price: num,
      sku: z.object({ data: z.object({ title: z.string().nullish() }).passthrough().nullish() }).passthrough().nullish(),
    }).passthrough()).nullish(),
  }).passthrough().nullish(),
}).passthrough();

const envelopeSchema = z.object({
  event: z.string(),
  merchant: z.object({ alias: z.string().nullish() }).passthrough().nullish(),
  resource: z.unknown(),
}).passthrough();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Yampi dates may be date-only (billet due date) or full wall-clock timestamps in the store timezone. */
function yampiLocalDate(value: string | null, timezone: string): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d)(?::(\d\d))?)?/.exec(value.trim());
  if (!m) return null;
  return yampiDateToIso({ date: `${m[1]}-${m[2]}-${m[3]} ${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}`, timezone });
}

export function parseYampiEvent(raw: unknown): YampiEvent {
  const { event, merchant, resource } = envelopeSchema.parse(raw);
  const isCart = event === "cart.reminder";
  const isOrder = (ORDER_EVENTS as readonly string[]).includes(event);
  if (!isCart && !isOrder) return { kind: "ignored", event };

  const r = resourceSchema.parse(resource);
  const c = r.customer?.data;
  const email = c?.email?.trim().toLowerCase() ?? "";
  const customer: StoreCustomer = {
    email: EMAIL.test(email) ? email : null,
    name: c?.name?.trim().slice(0, 200) || null,
    phone: normalizeBrazilMobile(c?.phone?.full_number ?? null),
  };
  const items: StoreItem[] = (r.items?.data ?? []).map((i) => ({
    name: (i.sku?.data?.title ?? "").slice(0, 200),
    variant: null, // Yampi fixture has no clear variant field
    quantity: i.quantity,
    price: i.price,
    imageUrl: null,
  }));
  const merchantAlias = merchant?.alias ?? "";

  if (isCart) {
    return { kind: "cart", event: "cart.reminder", merchantAlias, customer,
      cart: { externalId: r.id, token: r.token, total: r.totalizers?.total ?? 0, shipping: r.totalizers?.shipment ?? null, recoveryUrl: r.simulate_url,
        abandonedAt: r.created_at ? yampiDateToIso(r.created_at) : null, items } };
  }
  const statusAlias = r.status?.data?.alias ?? null;
  const timezone = r.created_at?.timezone || "America/Sao_Paulo";
  // Boleto transactions carry the due date and the payment link; Pix usually only has the public order page.
  const billing = (r.transactions?.data ?? []).find((t) => t.billet_date || t.billet_url);
  return { kind: "order", event: event as (typeof ORDER_EVENTS)[number], merchantAlias, customer,
    order: { externalId: r.id, number: r.number ?? r.id, statusAlias,
      paymentAlias: billing?.payment?.data?.alias ?? r.payments?.[0]?.alias ?? null, total: r.value_total ?? 0, cartToken: r.cart_token,
      paid: event === "order.paid" || statusAlias === "paid", items, trackCode: r.track_code, trackUrl: r.track_url,
      publicUrl: r.public_url, paymentUrl: billing?.billet_url ?? r.public_url ?? r.reorder_url,
      dueAt: yampiLocalDate(billing?.billet_date ?? null, timezone) } };
}

/** Header is base64(HMAC-SHA256(raw body, secret)); verified over the raw bytes. */
export async function verifyYampiSignature(body: Uint8Array, header: string | null, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    expected = Uint8Array.from(atob(header.trim()), (ch) => ch.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, expected, Uint8Array.from(body)); // verify() compares in constant time
}
