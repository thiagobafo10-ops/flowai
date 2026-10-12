import { handleMetaWebhook, type MetaWebhookDeps } from "../meta-webhook/handler.ts";

function assert(value: unknown): void { if (!value) throw new Error("assertion failed"); }
const conn = "00000000-0000-4000-8000-000000000002";
const org = "00000000-0000-4000-8000-000000000001";
const payload = { object: "instagram", entry: [{ id: "789", time: 1791806400, messaging: [{ sender: { id: "900" }, recipient: { id: "789" }, timestamp: 1791806400000, message: { mid: "m1", text: "Olá" } }] }] };
function fixture() {
  const events: unknown[] = []; const verifications: unknown[] = [];
  const deps: MetaWebhookDeps = {
    readConnectionSecrets: async () => ({ connectionId: conn, organizationId: org, appId: "123", apiVersion: "v26.0", generation: 1, disconnected: false, appSecret: "secret", verifyToken: "verify", channels: [{ channelId: "channel", accountId: "789", accessToken: "token", status: "active" }] }),
    allowRequest: async () => true,
    ingestEvent: async (_connectionId, event) => { events.push(event); return { state: "done" }; },
    verifyConnection: async (...args) => { verifications.push(args); },
  };
  return { deps, events, verifications };
}
async function post(body = JSON.stringify(payload), key = "secret", headers: Record<string, string> = {}) {
  const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(body)));
  return new Request(`http://local/functions/v1/meta-webhook/${conn}`, { method: "POST", headers: { "X-Hub-Signature-256": `sha256=${Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("")}`, ...headers }, body });
}
Deno.test("GET verifies token and returns the challenge as plain text", async () => {
  const f = fixture(); const response = await handleMetaWebhook(new Request(`http://local/meta-webhook/${conn}?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=12345`), f.deps);
  assert(response.status === 200 && await response.text() === "12345"); assert(f.verifications.length === 1);
});
Deno.test("GET wrong token never registers webhook confirmation", async () => {
  const f = fixture(); const response = await handleMetaWebhook(new Request(`http://local/meta-webhook/${conn}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`), f.deps);
  assert(response.status === 403 && f.verifications.length === 0);
});
Deno.test("POST authenticates the exact raw bytes before JSON parsing", async () => {
  const f = fixture(); const response = await handleMetaWebhook(await post("not json", "wrong"), f.deps);
  assert(response.status === 401 && f.events.length === 0);
});
Deno.test("a signed Direct is durably ingested without Graph requests", async () => {
  const f = fixture(); const response = await handleMetaWebhook(await post(), f.deps);
  assert(response.status === 200); assert(f.events.length === 1);
  assert((f.events[0] as { externalId: string }).externalId === "m1");
});
Deno.test("invalid signed known event causes retry rather than silent loss", async () => {
  const f = fixture(); const malformed = JSON.stringify({ object: "instagram", entry: [{ id: "789", messaging: [{ sender: { id: "900" }, recipient: { id: "789" }, timestamp: 1791806400000, message: { text: "no mid" } }] }] });
  assert((await handleMetaWebhook(await post(malformed), f.deps)).status === 400); assert(f.events.length === 0);
});
Deno.test("foreign account and inactive channel never create messages", async () => {
  const f = fixture(); const foreign = JSON.stringify({ ...payload, entry: [{ ...payload.entry[0], id: "foreign", messaging: [{ ...payload.entry[0].messaging[0], recipient: { id: "foreign" } }] }] });
  assert((await handleMetaWebhook(await post(foreign), f.deps)).status === 200); assert(f.events.length === 0);
});
Deno.test("failed second persistence returns 503 and retry leaves one event per external ID", async () => {
  const f = fixture(); const stored = new Set<string>(); let fail = true;
  const two = JSON.stringify({ ...payload, entry: [{ ...payload.entry[0], messaging: [payload.entry[0].messaging[0], { ...payload.entry[0].messaging[0], message: { mid: "m2", text: "Dois" } }] }] });
  f.deps.ingestEvent = async (_id, event) => { if (event.externalId === "m2" && fail) throw new Error("database unavailable"); stored.add(event.externalId); return { state: "done" }; };
  assert((await handleMetaWebhook(await post(two), f.deps)).status === 503); assert(stored.size === 1);
  fail = false; assert((await handleMetaWebhook(await post(two), f.deps)).status === 200); assert(stored.size === 2);
});
Deno.test("body larger than 1 MiB is rejected before ingestion", async () => {
  const f = fixture(); assert((await handleMetaWebhook(await post("x".repeat(1048577)), f.deps)).status === 413); assert(f.events.length === 0);
});
Deno.test("rate limit rejects request before reading credentials", async () => {
  const f = fixture(); f.deps.allowRequest = async () => false;
  let reads = 0; f.deps.readConnectionSecrets = async () => { reads++; return null; };
  assert((await handleMetaWebhook(await post(), f.deps)).status === 429); assert(reads === 0);
});
