import { processInstagramPublicReplyWork, type PublicReplyDeps } from "../instagram-worker/public-reply.ts";
import { drainInstagramWork, type InstagramWorkerDeps } from "../instagram-worker/handler.ts";
function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }

const COMMENT = { id: "123", timestamp: "2026-10-11T12:00:00Z", from: { id: "900", username: "cliente" }, media: { id: "456", media_product_type: "FEED" } };
function fixture() {
  const posts: { path: string; body: unknown }[] = []; const completes: { state: string; externalId: string | null; errorCode: string | null }[] = [];
  const finishes: unknown[][] = []; const claims: unknown[][] = [];
  const deps: PublicReplyDeps = {
    preparePublicReply: async () => ({ replyId: "reply", eventId: "ev", organizationId: "org", channelId: "ch", connectionId: "conn", commentId: "123", mediaId: "456", originalMediaId: null, senderExternalId: "900", ruleEffectiveAt: "2026-10-10T00:00:00Z", state: "pending" }),
    claimPublicReply: async (...args) => { claims.push(args); return { id: "reply", claimToken: "claim", text: "Te mandei no Direct!" }; },
    completePublicReply: async (_id, _token, state, externalId, errorCode) => { completes.push({ state, externalId, errorCode }); },
    finishPublicReplyWork: async (...args) => { finishes.push(args); },
    readConnectionSecrets: async () => ({ connectionId: "conn", organizationId: "org", appId: "app", apiVersion: "v26.0", generation: 1, disconnected: false, appSecret: "secret", verifyToken: "verify", channels: [{ channelId: "ch", accountId: "789", username: "empresa", status: "active", accessToken: "token" }] }),
    now: () => new Date("2026-10-12T12:00:00Z"),
    fetch: async (url, init) => {
      const path = String(url);
      if (init?.method === "POST") { posts.push({ path, body: JSON.parse(String(init.body)) }); return Response.json({ id: "public-reply" }); }
      if (path.includes("/123?")) return Response.json(COMMENT);
      return Response.json({ id: "456", owner: { id: "789", username: "empresa" } });
    },
  };
  return { deps, posts, completes, finishes, claims };
}
const item = { queueId: 7, eventId: "ev", task: "public_reply" as const };
function replyFails(f: ReturnType<typeof fixture>, respond: () => Response | Promise<Response>) {
  const fetcher = f.deps.fetch;
  f.deps.fetch = async (url, init) => { if (init?.method === "POST") { f.posts.push({ path: String(url), body: null }); return await respond(); } return fetcher(url, init); };
}

Deno.test("public reply posts the frozen text under the comment", async () => {
  const f = fixture();
  assert(await processInstagramPublicReplyWork(item, f.deps) === "done");
  assert(f.posts.length === 1 && f.posts[0].path.endsWith("/123/replies"));
  assert(JSON.stringify(f.posts[0].body) === JSON.stringify({ message: "Te mandei no Direct!" }));
  assert(f.completes[0].state === "sent" && f.completes[0].externalId === "public-reply");
  assert(JSON.stringify(f.finishes) === '[[7,"done",null]]');
  assert(f.claims[0][1] === COMMENT.timestamp && f.claims[0][2] === "conn" && f.claims[0][3] === 1, "claim binds comment time and credential snapshot");
});
Deno.test("429 returns the reply to pending and retries the work", async () => {
  const f = fixture(); replyFails(f, () => Response.json({ error: { code: 4 } }, { status: 429 }));
  assert(await processInstagramPublicReplyWork(item, f.deps) === "retry");
  assert(f.completes[0].state === "pending" && f.completes[0].errorCode === "rate_limited");
  assert(JSON.stringify(f.finishes) === '[[7,"retry","rate_limited"]]');
});
Deno.test("timeout becomes uncertain and is never posted again", async () => {
  const f = fixture(); replyFails(f, () => { throw new Error("timeout"); });
  assert(await processInstagramPublicReplyWork(item, f.deps) === "uncertain");
  assert(f.completes[0].state === "uncertain" && f.completes[0].errorCode === "network_error");
  const again = fixture(); const prepare = again.deps.preparePublicReply;
  again.deps.preparePublicReply = async (id) => { const p = await prepare(id); return p ? { ...p, state: "uncertain" } : null; };
  assert(await processInstagramPublicReplyWork(item, again.deps) === "uncertain");
  assert(again.posts.length === 0 && again.claims.length === 0);
});
Deno.test("invalid provider response is uncertain", async () => {
  const f = fixture(); replyFails(f, () => Response.json({ ok: true }));
  assert(await processInstagramPublicReplyWork(item, f.deps) === "uncertain");
  assert(f.completes[0].state === "uncertain" && f.completes[0].errorCode === "invalid_response");
});
Deno.test("missing comment permission fails with the VIP permission code", async () => {
  const f = fixture(); replyFails(f, () => Response.json({ error: { code: 10, message: "permission texto do comentário" } }, { status: 403 }));
  assert(await processInstagramPublicReplyWork(item, f.deps) === "failed");
  assert(f.completes[0].state === "failed" && f.completes[0].errorCode === "permission_denied");
  assert(JSON.stringify(f.finishes) === '[[7,"failed","permission_denied"]]', "only codes are acknowledged");
});
Deno.test("reservation refused (paused automation or VIP replied) produces no POST", async () => {
  const f = fixture(); f.deps.claimPublicReply = async () => null;
  assert(await processInstagramPublicReplyWork(item, f.deps) === "ignored"); assert(f.posts.length === 0);
});
Deno.test("own account comment is never answered", async () => {
  const f = fixture(); const fetcher = f.deps.fetch;
  f.deps.fetch = async (url, init) => String(url).includes("/123?") ? Response.json({ ...COMMENT, from: { id: "900", username: "EMPRESA" } }) : fetcher(url, init);
  assert(await processInstagramPublicReplyWork(item, f.deps) === "ignored"); assert(f.posts.length === 0 && f.claims.length === 0);
});
Deno.test("comment older than the rule is not answered", async () => {
  const f = fixture(); const fetcher = f.deps.fetch;
  f.deps.fetch = async (url, init) => String(url).includes("/123?") ? Response.json({ ...COMMENT, timestamp: "2026-10-09T12:00:00Z" }) : fetcher(url, init);
  assert(await processInstagramPublicReplyWork(item, f.deps) === "ignored"); assert(f.posts.length === 0);
});
Deno.test("foreign media is not answered; ad comment checks the original media", async () => {
  const f = fixture(); const fetcher = f.deps.fetch;
  f.deps.fetch = async (url, init) => String(url).includes("/456?") ? Response.json({ id: "456", owner: { id: "other", username: "other" } }) : fetcher(url, init);
  assert(await processInstagramPublicReplyWork(item, f.deps) === "ignored"); assert(f.posts.length === 0);
  const ad = fixture(); const prepare = ad.deps.preparePublicReply; const ownership: string[] = [];
  ad.deps.preparePublicReply = async (id) => { const p = await prepare(id); return p ? { ...p, mediaId: "ad1", originalMediaId: "456" } : null; };
  const adFetch = ad.deps.fetch;
  ad.deps.fetch = async (url, init) => { const path = String(url); if (path.includes("/123?")) return Response.json({ ...COMMENT, media: { id: "ad1", media_product_type: "AD" } }); if (path.includes("/456?")) ownership.push(path); return adFetch(url, init); };
  assert(await processInstagramPublicReplyWork(item, ad.deps) === "done"); assert(ownership.length === 1);
});
Deno.test("disconnected or foreign secrets never call the provider", async () => {
  const f = fixture(); f.deps.readConnectionSecrets = async () => null; f.deps.fetch = async () => { throw new Error("must not fetch"); };
  assert(await processInstagramPublicReplyWork(item, f.deps) === "ignored");
  assert(JSON.stringify(f.finishes) === '[[7,"ignored","channel_inactive"]]');
});
Deno.test("already sent reply is acknowledged without posting", async () => {
  const f = fixture(); const prepare = f.deps.preparePublicReply;
  f.deps.preparePublicReply = async (id) => { const p = await prepare(id); return p ? { ...p, state: "sent" } : null; };
  assert(await processInstagramPublicReplyWork(item, f.deps) === "done"); assert(f.posts.length === 0);
});
Deno.test("the DM still runs when the public reply fails", async () => {
  const f = fixture(); let dmSends = 0; const legacyFinishes: unknown[][] = []; let batches = 0;
  const fetcher = f.deps.fetch;
  const deps: InstagramWorkerDeps = {
    ...f.deps,
    readWorkerSecret: async () => "secret",
    readWork: async () => batches++ === 0 ? [{ queueId: 1, eventId: "ev" }, item] : [],
    prepare: async () => ({ eventId: "ev", organizationId: "org", channelId: "ch", connectionId: "conn", intentId: "intent", commentId: "123", mediaId: "456", senderExternalId: "900", ruleEffectiveAt: "2026-10-10T00:00:00Z", state: "pending" }),
    reselect: async () => null,
    claim: async () => ({ intentId: "intent", connectionId: "conn", channelId: "ch", kind: "private_reply", text: "Seu guia", recipientExternalId: null, commentId: "123", claimToken: "claim" }),
    complete: async () => {},
    prepareProfile: async () => null, saveContactName: async () => {},
    finishWork: async (...args) => { legacyFinishes.push(args); },
    fetch: async (url, init) => {
      const path = String(url);
      if (init?.method === "POST" && path.endsWith("/replies")) throw new Error("timeout");
      if (init?.method === "POST") { dmSends++; return Response.json({ message_id: "dm", recipient_id: "900" }); }
      return fetcher(url, init);
    },
  };
  const results = await drainInstagramWork(deps, 60_000);
  assert(results.includes("done") && results.includes("uncertain"), JSON.stringify(results));
  assert(dmSends === 1, "private reply sent");
  assert(JSON.stringify(legacyFinishes) === '[[1,"done",null]]', "DM acknowledged as done");
  assert(f.completes.some((c) => c.state === "uncertain"), "public reply uncertain");
});
