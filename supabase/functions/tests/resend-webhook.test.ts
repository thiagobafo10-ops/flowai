import { handleResendWebhook, type ResendWebhookDeps } from "../resend-webhook/handler.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }

const RAW = new Uint8Array(32).map((_, i) => i + 1);
const SECRET = "whsec_" + btoa(String.fromCharCode(...RAW));
const OTHER = "whsec_" + btoa("another-secret-another-secret-12");
const NOW = new Date("2026-11-03T12:00:00Z");
const nowTs = String(Math.floor(NOW.getTime() / 1000));

async function sign(id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey("raw", RAW, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return "v1," + btoa(String.fromCharCode(...mac));
}
function fixture() {
  const recorded: unknown[][] = [];
  const deps: ResendWebhookDeps = {
    readSecrets: async () => [{ organizationId: "o1", secret: OTHER }, { organizationId: "o2", secret: SECRET }],
    record: async (...args) => { recorded.push(args); },
    now: () => NOW,
  };
  return { deps, recorded };
}
async function request(type: string, opts: { ts?: string; signature?: string } = {}) {
  const body = JSON.stringify({ type, created_at: "2026-11-03T11:59:00.000Z", data: { email_id: "resend-id-1" } });
  const ts = opts.ts ?? nowTs;
  return new Request("http://local/resend-webhook", {
    method: "POST", body,
    headers: { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": opts.signature ?? `v1,Ym9ndXM= ${await sign("msg_1", ts, body)}` },
  });
}

Deno.test("valid signature records the event", async () => {
  const f = fixture();
  const response = await handleResendWebhook(await request("email.delivered"), f.deps);
  assert(response.status === 200, String(response.status));
  assert(JSON.stringify(f.recorded) === JSON.stringify([[["o2"], "resend-id-1", "email.delivered", "2026-11-03T11:59:00.000Z"]]), JSON.stringify(f.recorded));
});

Deno.test("a shared signing secret authorizes only its matching organizations", async () => {
  const f = fixture();
  f.deps.readSecrets = async () => [{ organizationId: "o1", secret: OTHER }, { organizationId: "o2", secret: SECRET }, { organizationId: "o3", secret: SECRET }];
  await handleResendWebhook(await request("email.delivered"), f.deps);
  assert(JSON.stringify(f.recorded[0]?.[0]) === JSON.stringify(["o2", "o3"]), JSON.stringify(f.recorded));
});

Deno.test("email.bounced passes its type through", async () => {
  const f = fixture();
  await handleResendWebhook(await request("email.bounced"), f.deps);
  assert(f.recorded[0]![2] === "email.bounced");
});

Deno.test("invalid or missing signature is rejected", async () => {
  const f = fixture();
  const response = await handleResendWebhook(await request("email.delivered", { signature: "v1,AAAA" }), f.deps);
  assert(response.status === 401 && f.recorded.length === 0);
  const missing = await handleResendWebhook(new Request("http://local/resend-webhook", { method: "POST", body: "{}" }), f.deps);
  assert(missing.status === 401);
});

Deno.test("a timestamp 10 minutes old is rejected even when correctly signed", async () => {
  const f = fixture();
  const response = await handleResendWebhook(await request("email.delivered", { ts: String(Number(nowTs) - 600) }), f.deps);
  assert(response.status === 401 && f.recorded.length === 0);
});
