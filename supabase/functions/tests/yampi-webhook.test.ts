import { handleYampiWebhook } from "../yampi-webhook/handler.ts";
import type { YampiWebhookDeps } from "../yampi-webhook/handler.ts";

const conn = "00000000-0000-4000-8000-000000000002";
const secret = "yampi-secret";
function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
async function sign(body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))));
}
const cart = { event: "cart.reminder", merchant: { alias: "loja" }, resource: { id: 1, token: "t", simulate_url: "https://x", totalizers: { total: 10 }, customer: { data: { email: "a@b.co" } }, items: { data: [] } } };
function fixture() {
  const ingested: unknown[][] = [];
  const deps: YampiWebhookDeps = {
    readConnection: async () => ({ organizationId: "org", secret }),
    allowIp: async () => true,
    ingest: async (...args) => { ingested.push(args); return { state: "ok" }; },
  };
  const request = async (body: unknown, opts: { signature?: string; method?: string; raw?: boolean } = {}) => {
    const text = opts.raw ? String(body) : JSON.stringify(body);
    return new Request(`http://local/yampi-webhook/${conn}`, { method: opts.method ?? "POST", headers: { "X-Yampi-Hmac-SHA256": opts.signature ?? await sign(text) }, body: opts.method === "GET" ? undefined : text });
  };
  return { deps, ingested, request };
}

Deno.test("valid signature ingests a cart event once", async () => {
  const f = fixture();
  const response = await handleYampiWebhook(await f.request(cart), f.deps);
  assert(response.status === 200);
  assert(f.ingested.length === 1 && (f.ingested[0][1] as { kind: string }).kind === "cart" && /^[0-9a-f]{64}$/.test(f.ingested[0][2] as string));
});
Deno.test("signature is checked over the raw body, extra spaces included", async () => {
  const f = fixture();
  const response = await handleYampiWebhook(await f.request(`  ${JSON.stringify(cart, null, 2)}  `, { raw: true }), f.deps);
  assert(response.status === 200 && f.ingested.length === 1);
});
Deno.test("invalid signature returns 401 without ingest", async () => {
  const f = fixture();
  const response = await handleYampiWebhook(await f.request(cart, { signature: "AAAA" }), f.deps);
  assert(response.status === 401 && f.ingested.length === 0);
});
Deno.test("unknown connection returns 404", async () => {
  const f = fixture(); f.deps.readConnection = async () => null;
  assert((await handleYampiWebhook(await f.request(cart), f.deps)).status === 404);
});
Deno.test("GET returns 405", async () => {
  const f = fixture();
  assert((await handleYampiWebhook(await f.request(cart, { method: "GET" }), f.deps)).status === 405);
});
Deno.test("rate limited IP returns 429", async () => {
  const f = fixture(); f.deps.allowIp = async () => false;
  assert((await handleYampiWebhook(await f.request(cart), f.deps)).status === 429);
});
Deno.test("unknown valid event returns 200 without ingest", async () => {
  const f = fixture();
  const response = await handleYampiWebhook(await f.request({ event: "customer.created", resource: {} }), f.deps);
  assert(response.status === 200 && f.ingested.length === 0);
});
Deno.test("malformed known event returns 400", async () => {
  const f = fixture();
  const response = await handleYampiWebhook(await f.request({ event: "cart.reminder", resource: { token: "x" } }), f.deps);
  assert(response.status === 400 && f.ingested.length === 0);
});
Deno.test("invalid JSON returns 400", async () => {
  const f = fixture();
  assert((await handleYampiWebhook(await f.request("{nope", { raw: true }), f.deps)).status === 400);
});
Deno.test("database error returns 503", async () => {
  const f = fixture(); f.deps.ingest = async () => { throw new Error("db"); };
  assert((await handleYampiWebhook(await f.request(cart), f.deps)).status === 503);
});
