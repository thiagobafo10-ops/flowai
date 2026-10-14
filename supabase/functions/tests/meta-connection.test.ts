import { handleMetaConnection } from "../meta-connection/handler.ts";
import type { MetaConnectionDeps } from "../meta-connection/handler.ts";
import { RepositoryError } from "../_shared/meta-repository.ts";

const org = "00000000-0000-4000-8000-000000000001";
const conn = "00000000-0000-4000-8000-000000000002";
function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
function fixture() {
  const writes: unknown[] = [];
  const secrets = { connectionId: conn, organizationId: org, appId: "123", apiVersion: "v26.0", generation: 1, disconnected: false, appSecret: "app-secret", verifyToken: "verify-secret", channels: [{ channelId: "channel", accountId: "789", accessToken: "access-secret", status: "needs_setup" }] };
  const deps: MetaConnectionDeps = {
    authorize: async () => ({ userId: "user" }),
    repository: {
      saveConnection: async (userId, organizationId, input) => { writes.push({ userId, organizationId, input }); return { connectionId: conn, channelId: "channel" }; },
      readConnectionSecrets: async () => secrets,
      verifyConnection: async (...args) => { writes.push(args); },
      disconnectConnection: async (...args) => { writes.push(args); },
      verifyMedia: async (...args) => { writes.push(args); },
      removeConnection: async (...args) => { writes.push(["remove", ...args]); return { removed: true, disconnected: false }; },
      recordInstagramUsername: async (...args) => { writes.push(["username", ...args]); },
    },
    fetch: async (input) => String(input).includes("/me?") ? Response.json({ user_id: "789", username: "empresa" }) : Response.json({ success: true }),
  };
  const request = (action: string, more: Record<string, unknown> = {}) => new Request("http://local/meta-connection", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer user-jwt" }, body: JSON.stringify({ action, organizationId: org, connectionId: conn, ...more }) });
  return { deps, writes, secrets, request };
}

Deno.test("invalid JWT causes no privileged reads or writes", async () => {
  const f = fixture(); f.deps.authorize = async () => null;
  let reads = 0; f.deps.repository.readConnectionSecrets = async () => { reads++; return f.secrets; };
  assert((await handleMetaConnection(f.request("test"), f.deps)).status === 403);
  assert(reads === 0 && f.writes.length === 0);
});
Deno.test("foreign organization is rejected even if token user has admin elsewhere", async () => {
  const f = fixture(); f.secrets.organizationId = "foreign";
  assert((await handleMetaConnection(f.request("test"), f.deps)).status === 403);
  assert(f.writes.length === 0);
});
Deno.test("wrong token account does not activate a channel", async () => {
  const f = fixture(); f.deps.fetch = async () => Response.json({ user_id: "other", username: "wrong" });
  const response = await handleMetaConnection(f.request("test"), f.deps);
  assert(response.status === 422); assert(JSON.stringify(f.writes).includes("invalid_account"));
});
Deno.test("valid connection verifies account and enables required subscriptions", async () => {
  const f = fixture(); const calls: { url: string; body: unknown; authorization: string | null }[] = [];
  f.deps.fetch = async (input, init) => { calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null, authorization: new Headers(init?.headers).get("authorization") }); return calls.length === 1 ? Response.json({ user_id: "789", username: "empresa" }) : Response.json({ success: true }); };
  const response = await handleMetaConnection(f.request("test"), f.deps);
  assert(response.status === 200); assert(calls.length === 2);
  assert(calls[0].url === "https://graph.instagram.com/v26.0/me?fields=user_id%2Cusername");
  assert(calls[1].url === "https://graph.instagram.com/v26.0/789/subscribed_apps");
  assert(JSON.stringify(calls[1].body) === '{"subscribed_fields":["messages","comments","messaging_seen"]}');
  assert(calls[1].authorization === "Bearer access-secret");
  const body = await response.text(); assert(!body.includes("secret"));
});
Deno.test("expired token returns safe error and invalidates verification", async () => {
  const f = fixture(); f.deps.fetch = async () => Response.json({ error: { code: 190, message: "access-secret expired" } }, { status: 401 });
  const response = await handleMetaConnection(f.request("test"), f.deps);
  assert(response.status === 422); assert(!(await response.text()).includes("access-secret"));
  assert(JSON.stringify(f.writes).includes("invalid_token"));
});
Deno.test("verify token is explicitly revealed with no cache and no app/access secrets", async () => {
  const f = fixture(); const response = await handleMetaConnection(f.request("reveal_verify_token"), f.deps);
  assert(response.headers.get("cache-control") === "no-store");
  const text = await response.text(); assert(text.includes("verify-secret")); assert(!text.includes("app-secret") && !text.includes("access-secret"));
});
Deno.test("disconnect uses authenticated actor and preserves history via repository operation", async () => {
  const f = fixture(); assert((await handleMetaConnection(f.request("disconnect"), f.deps)).status === 200);
  assert(JSON.stringify(f.writes) === JSON.stringify([["user", org, conn]]));
});
Deno.test("save never exposes the secrets returned accidentally by a repository", async () => {
  const f = fixture(); f.deps.repository.saveConnection = async () => ({ connectionId: conn, channelId: "channel", appSecret: "secret-leak" } as { connectionId: string; channelId: string });
  const response = await handleMetaConnection(f.request("save", { input: { appId: "123", accountId: "789", appSecret: "app-secret", accessToken: "access-secret", apiVersion: "v26.0" } }), f.deps);
  assert(response.status === 200); assert(!(await response.text()).includes("secret"));
});
Deno.test("specific post validation rejects media owned by another account", async () => {
  const f = fixture(); f.deps.fetch = async () => Response.json({ id: "80001", owner: { id: "foreign" } });
  assert((await handleMetaConnection(f.request("validate_media", { channelId: "channel", mediaId: "80001" }), f.deps)).status === 422);
  assert(f.writes.length === 0);
});
Deno.test("owned media receives a server-only validation seal for current credentials", async () => {
  const f = fixture(); f.deps.fetch = async () => Response.json({ id: "80001", owner: { id: "789" } });
  const response = await handleMetaConnection(f.request("validate_media", { channelId: "channel", mediaId: "80001" }), f.deps);
  assert(response.status === 200); assert(JSON.stringify(f.writes) === JSON.stringify([[conn,"channel","80001",1]]));
});
Deno.test("remove is authorized by the service RPC and never reads secrets", async () => {
  const f = fixture(); let reads = 0; f.deps.repository.readConnectionSecrets = async () => { reads++; return f.secrets; };
  const response = await handleMetaConnection(f.request("remove"), f.deps);
  assert(response.status === 200); assert(reads === 0);
  assert(JSON.stringify(f.writes) === JSON.stringify([["remove", "user", org, conn]]));
  assert(JSON.stringify(await response.json()) === '{"removed":true,"disconnected":false}');
});
Deno.test("account claimed by another organization maps to a dedicated error", async () => {
  const f = fixture(); f.deps.repository.saveConnection = async () => { throw new RepositoryError("23505"); };
  const response = await handleMetaConnection(f.request("save", { input: { appId: "123" } }), f.deps);
  assert(response.status === 409); assert((await response.json()).error === "already_connected");
});
Deno.test("duplicate app in the same organization keeps its own error", async () => {
  const f = fixture(); f.deps.repository.saveConnection = async () => { throw new RepositoryError("23505", "same_organization"); };
  const response = await handleMetaConnection(f.request("save", { input: { appId: "123" } }), f.deps);
  assert(response.status === 409); assert((await response.json()).error === "app_already_connected");
});
Deno.test("streamed body without Content-Length is cut at 32 KiB", async () => {
  const f = fixture(); const chunk = new TextEncoder().encode("x".repeat(16384)); let sent = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (sent++ < 4) controller.enqueue(chunk); else controller.close(); } });
  const request = new Request("http://local/meta-connection", { method: "POST", headers: { Authorization: "Bearer user-jwt" }, body });
  assert((await handleMetaConnection(request, f.deps)).status === 413); assert(sent < 5, "reader stopped before draining the stream");
});
Deno.test("verified account stores the Instagram username for the channel", async () => {
  const f = fixture();
  const response = await handleMetaConnection(f.request("test"), f.deps);
  assert(response.status === 200);
  assert(JSON.stringify(f.writes) === JSON.stringify([[conn, "token", true, null, 1], ["username", "channel", "empresa"]]));
  assert((await response.json()).username === "empresa");
});
Deno.test("missing or invalid username is not stored", async () => {
  for (const profile of [{ user_id: "789" }, { user_id: "789", username: "não válido" }]) {
    const f = fixture(); f.deps.fetch = async (input) => String(input).includes("/me?") ? Response.json(profile) : Response.json({ success: true });
    assert((await handleMetaConnection(f.request("test"), f.deps)).status === 200);
    assert(!JSON.stringify(f.writes).includes("username"));
  }
});
Deno.test("failed verification does not store the username", async () => {
  const f = fixture(); f.deps.fetch = async (input) => String(input).includes("/me?") ? Response.json({ user_id: "789", username: "empresa" }) : Response.json({ success: false });
  assert((await handleMetaConnection(f.request("test"), f.deps)).status === 422);
  assert(!JSON.stringify(f.writes).includes("username"));
});
Deno.test("username storage failure keeps the verification result", async () => {
  const f = fixture(); f.deps.repository.recordInstagramUsername = async () => { throw new RepositoryError("22023"); };
  const logs: unknown[][] = []; f.deps.log = (...args) => { logs.push(args); };
  const response = await handleMetaConnection(f.request("test"), f.deps);
  assert(response.status === 200); assert((await response.json()).verified === true);
  assert(JSON.stringify(logs) === JSON.stringify([["meta-connection", "instagram_username_record_failed", "22023"]]));
  assert(!JSON.stringify(logs).includes("empresa"));
});
