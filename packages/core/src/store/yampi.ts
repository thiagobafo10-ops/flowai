import { z } from "zod";

export type StoreItem = { name: string; variant: string | null; quantity: number; price: number; imageUrl: string | null };
export type StoreCustomer = { email: string | null; name: string | null; phone: string | null };
export type YampiEvent =
  | { kind: "cart"; event: "cart.reminder"; merchantAlias: string; customer: StoreCustomer;
      cart: { externalId: string; token: string | null; total: number; recoveryUrl: string | null; items: StoreItem[] } }
  | { kind: "order"; event: "order.created" | "order.paid" | "order.status.updated"; merchantAlias: string; customer: StoreCustomer;
      order: { externalId: string; number: string; statusAlias: string | null; paymentAlias: string | null; total: number;
               cartToken: string | null; paid: boolean; items: StoreItem[]; trackCode: string | null; trackUrl: string | null } }
  | { kind: "ignored"; event: string };

const ORDER_EVENTS = ["order.created", "order.paid", "order.status.updated"] as const;

const str = z.union([z.string(), z.number()]).nullish().transform((v) => (v == null || v === "" ? null : String(v)));
const num = z.coerce.number().catch(0);

const resourceSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  token: str,
  simulate_url: str,
  number: str,
  cart_token: str,
  track_code: str,
  track_url: str,
  value_total: num.optional(),
  totalizers: z.object({ total: num }).passthrough().nullish(),
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
    phone: c?.phone?.full_number ?? null,
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
      cart: { externalId: r.id, token: r.token, total: r.totalizers?.total ?? 0, recoveryUrl: r.simulate_url, items } };
  }
  return { kind: "order", event: event as (typeof ORDER_EVENTS)[number], merchantAlias, customer,
    order: { externalId: r.id, number: r.number ?? r.id, statusAlias: r.status?.data?.alias ?? null,
      paymentAlias: r.payments?.[0]?.alias ?? null, total: r.value_total ?? 0, cartToken: r.cart_token,
      paid: event === "order.paid", items, trackCode: r.track_code, trackUrl: r.track_url } };
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
