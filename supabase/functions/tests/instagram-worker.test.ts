import { handleInstagramWorker, processInstagramWork, type InstagramWorkerDeps } from "../instagram-worker/handler.ts";
function assert(value: unknown, message = "assertion failed"): void { if (!value) throw new Error(message); }
function fixture() {
  let sends = 0; const finished: unknown[] = [];
  const work = { queueId: 1, eventId: "event" };
  const deps: InstagramWorkerDeps = {
    readWorkerSecret: async () => "worker-secret", readWork: async () => [work],
    prepare: async () => ({ eventId: "event", organizationId: "org", channelId: "channel", connectionId: "conn", intentId: "intent", commentId: "123", mediaId: "456", senderExternalId: "900", ruleEffectiveAt: "2026-10-10T00:00:00Z", state: "pending" }),
    claim: async () => ({ intentId: "intent", connectionId: "conn", channelId: "channel", kind: "private_reply", text: "Seu guia", recipientExternalId: null, commentId: "123", claimToken: "claim" }),
    complete: async () => {},
    finishWork: async (...args) => { finished.push(args); },
    readConnectionSecrets: async () => ({ connectionId: "conn", organizationId: "org", appId: "123", apiVersion: "v26.0", generation: 1, disconnected: false, appSecret: "app", verifyToken: "verify", channels: [{ channelId: "channel", accountId: "789", accessToken: "token", status: "active" }] }),
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("/123?")) return Response.json({ id: "123", timestamp: "2026-10-11T12:00:00+0000", from: { id: "900" }, media: { id: "456", media_product_type: "REELS" } });
      if (url.includes("/456?")) return Response.json({ id: "456", owner: { id: "789" } });
      sends++; assert(JSON.parse(String(init?.body)).recipient.comment_id === "123");
      return Response.json({ message_id: "out", recipient_id: "900" });
    },
    now: () => new Date("2026-10-12T12:00:00Z"),
  };
  return { deps, work, finished, sends: () => sends };
}
Deno.test("keyword work sends one private reply and acknowledges completion", async () => {
  const f = fixture(); assert(await processInstagramWork(f.work, f.deps) === "done"); assert(f.sends() === 1); assert(JSON.stringify(f.finished) === '[[1,"done",null]]');
});
Deno.test("changed rule is discarded before Graph API", async () => {
  const f = fixture(); f.deps.prepare = async () => null;
  assert(await processInstagramWork(f.work, f.deps) === "ignored"); assert(f.sends() === 0);
});
Deno.test("disconnected channel never sends", async () => {
  const f = fixture(); f.deps.readConnectionSecrets = async () => null;
  assert(await processInstagramWork(f.work, f.deps) === "ignored"); assert(f.sends() === 0);
});
Deno.test("actual comment older than seven days is not renewed by webhook delivery time", async () => {
  const f = fixture(); f.deps.fetch = async () => Response.json({ id: "123", timestamp: "2026-10-01T12:00:00+0000", from: { id: "900" }, media: { id: "456", media_product_type: "REELS" } });
  assert(await processInstagramWork(f.work, f.deps) === "ignored"); assert(f.sends() === 0);
});
Deno.test("comment posted before rule activation is not answered retroactively", async () => {
  const f = fixture(); f.deps.fetch = async () => Response.json({ id: "123", timestamp: "2026-10-09T12:00:00+0000", from: { id: "900" }, media: { id: "456", media_product_type: "FEED" } });
  assert(await processInstagramWork(f.work, f.deps) === "ignored"); assert(f.sends() === 0);
});
Deno.test("reactivating an old rule does not answer comments from its inactive period", async () => {
  const f = fixture(); const prepare = f.deps.prepare;
  f.deps.prepare = async (id) => { const original = await prepare(id); return original ? { ...original, ruleEffectiveAt: "2026-10-12T00:00:00Z" } : null; };
  assert(await processInstagramWork(f.work, f.deps) === "ignored"); assert(f.sends() === 0);
});
Deno.test("foreign media does not receive a private reply", async () => {
  const f = fixture(); const fetcher = f.deps.fetch; f.deps.fetch = async (input, init) => String(input).includes("/456?") ? Response.json({ id: "456", owner: { id: "foreign" } }) : fetcher(input, init);
  assert(await processInstagramWork(f.work, f.deps) === "ignored"); assert(f.sends() === 0);
});
Deno.test("timeout after sending is uncertain and never requeued", async () => {
  const f = fixture(); const fetcher = f.deps.fetch; f.deps.fetch = async (input, init) => { if (String(input).endsWith("/messages")) throw new Error("timeout"); return fetcher(input, init); };
  assert(await processInstagramWork(f.work, f.deps) === "uncertain"); assert(JSON.stringify(f.finished).includes('"uncertain"'));
});
Deno.test("failed metadata fetch can safely retry before any send claim", async () => {
  const f = fixture(); f.deps.fetch = async () => { throw new Error("metadata timeout"); };
  assert(await processInstagramWork(f.work, f.deps) === "retry"); assert(f.sends() === 0);
});
Deno.test("worker endpoint refuses missing secret before reading queue", async () => {
  const f = fixture(); let reads = 0; f.deps.readWork = async () => { reads++; return []; };
  assert((await handleInstagramWorker(new Request("http://local/worker", { method: "POST" }), f.deps)).status === 401); assert(reads === 0);
});
function request(secret = "worker-secret") { return new Request("http://local/worker", { method: "POST", headers: { "x-flowai-worker": secret } }); }
Deno.test("worker drains the queue in batches until it is empty", async () => {
  const f = fixture(); let queue = Array.from({ length: 7 }, (_, i) => ({ queueId: i + 1, eventId: `event-${i}` })); const limits: number[] = [];
  f.deps.readWork = async (limit) => { limits.push(limit); const batch = queue.slice(0, limit); queue = queue.slice(limit); return batch; };
  f.deps.prepare = async () => null;
  const body = await (await handleInstagramWorker(request(), f.deps)).json();
  assert(body.processed === 7); assert(queue.length === 0); assert(JSON.stringify(limits) === "[3,3,3,3]");
});
Deno.test("worker processes at most three items at the same time", async () => {
  const f = fixture(); let queue = Array.from({ length: 6 }, (_, i) => ({ queueId: i + 1, eventId: `event-${i}` }));
  let running = 0; let peak = 0;
  f.deps.readWork = async (limit) => { const batch = queue.slice(0, limit); queue = queue.slice(limit); return batch; };
  f.deps.prepare = async () => { running++; peak = Math.max(peak, running); await new Promise((resolve) => setTimeout(resolve, 5)); running--; return null; };
  await handleInstagramWorker(request(), f.deps);
  assert(peak === 3, `peak ${peak}`);
});
Deno.test("worker stops reading new work once the time budget is spent", async () => {
  const f = fixture(); let clock = Date.parse("2026-10-12T12:00:00Z"); let reads = 0;
  f.deps.now = () => new Date(clock);
  f.deps.readWork = async () => { reads++; clock += 60_000; return [{ queueId: reads, eventId: `event-${reads}` }]; };
  f.deps.prepare = async () => null;
  const body = await (await handleInstagramWorker(request(), f.deps)).json();
  assert(reads === 2, `reads ${reads}`); assert(body.processed === 2);
});
