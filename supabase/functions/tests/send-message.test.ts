import { handleSendMessage, type SendMessageDeps } from "../send-message/handler.ts";
function assert(value: unknown): void { if (!value) throw new Error("assertion failed"); }
const intentId = "00000000-0000-4000-8000-000000000003";
function fixture() {
  let state = "pending"; let calls = 0;
  const completed: unknown[] = [];
  const deps: SendMessageDeps = {
    authorize: async () => ({ userId: "actor" }),
    readIntent: async () => ({ id: intentId, organizationId: "org", actorId: "actor", messageId: "msg", state, kind: "direct" }),
    claim: async () => { if (state !== "pending") return null; state = "sending"; return { intentId, connectionId: "conn", channelId: "channel", kind: "direct", text: "Resposta", recipientExternalId: "900", commentId: null, claimToken: "claim" }; },
    complete: async (_id, result) => { completed.push(result); state = result.state; },
    readConnectionSecrets: async () => ({ connectionId: "conn", organizationId: "org", appId: "123", apiVersion: "v26.0", generation: 1, disconnected: false, appSecret: "app", verifyToken: "verify", channels: [{ channelId: "channel", accountId: "789", accessToken: "access-secret", status: "active" }] }),
    fetch: async (_input, init) => { calls++; assert(JSON.parse(String(init?.body)).recipient.id === "900"); return Response.json({ message_id: "out1", recipient_id: "900" }); },
    now: () => new Date("2026-10-12T12:00:00Z"),
  };
  const request = (extra = {}) => new Request("http://local/send-message", { method: "POST", body: JSON.stringify({ intentId, ...extra }), headers: { Authorization: "Bearer user" } });
  return { deps, request, completed, calls: () => calls, state: () => state };
}
Deno.test("duplicate invocation sends exactly once", async () => {
  const f = fixture(); assert((await handleSendMessage(f.request(), f.deps)).status === 200); assert((await handleSendMessage(f.request(), f.deps)).status === 200); assert(f.calls() === 1);
});
Deno.test("invalid user causes no credential read or Graph call", async () => {
  const f = fixture(); f.deps.authorize = async () => null;
  assert((await handleSendMessage(f.request(), f.deps)).status === 403); assert(f.calls() === 0 && f.completed.length === 0);
});
Deno.test("another actor cannot send an existing human intention", async () => {
  const f = fixture(); f.deps.authorize = async () => ({ userId: "other" });
  assert((await handleSendMessage(f.request(), f.deps)).status === 403); assert(f.calls() === 0);
});
Deno.test("arbitrary recipient and content in body are not used", async () => {
  const f = fixture(); assert((await handleSendMessage(f.request({ recipient: "attacker", text: "Changed" }), f.deps)).status === 200); assert(f.calls() === 1);
});
Deno.test("claim refuses closed window before any external send", async () => {
  const f = fixture(); f.deps.claim = async () => { throw new Error("window closed"); };
  assert((await handleSendMessage(f.request(), f.deps)).status === 503); assert(f.calls() === 0);
});
Deno.test("network ambiguity persists uncertain and is never resent automatically", async () => {
  const f = fixture(); let calls = 0; f.deps.fetch = async () => { calls++; throw new Error("timeout"); };
  const response = await handleSendMessage(f.request(), f.deps);
  assert(response.status === 200 && (await response.json()).state === "uncertain");
  assert(f.state() === "uncertain"); await handleSendMessage(f.request(), f.deps); assert(calls === 1);
});
Deno.test("explicit token rejection persists failed with safe error", async () => {
  const f = fixture(); f.deps.fetch = async () => Response.json({ error: { code: 190, message: "access-secret" } }, { status: 401 });
  const response = await handleSendMessage(f.request(), f.deps);
  assert((await response.json()).state === "failed"); assert(!JSON.stringify(f.completed).includes("access-secret"));
});
Deno.test("expired token deactivates the same credential generation", async () => {
  const f = fixture(); const invalidations: unknown[] = [];
  f.deps.verifyConnection = async (...args) => { invalidations.push(args); };
  f.deps.fetch = async () => Response.json({ error: { code: 190 } }, { status: 401 });
  await handleSendMessage(f.request(), f.deps);
  assert(JSON.stringify(invalidations) === JSON.stringify([["conn", "token", false, "invalid_token", 1]]));
});
