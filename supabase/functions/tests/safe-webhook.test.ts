import { isBlockedAddress, postSafeWebhook } from "../_shared/safe-webhook.ts";
function assert(value: unknown, message = "assertion failed"): void { if (!value) throw new Error(message); }

function spy(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    return Promise.resolve(respond(url, init));
  }) as typeof fetch;
  return { f, calls };
}
const publicResolve = () => Promise.resolve(["93.184.216.34"]);
const URL_OK = "https://hooks.example.com/path?token=secret";

Deno.test("isBlockedAddress covers private ranges and mapped IPv6", () => {
  for (const ip of ["0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.255", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "::", "::1", "fc00::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe"]) assert(isBlockedAddress(ip), ip);
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) assert(!isBlockedAddress(ip), ip);
  assert(isBlockedAddress("not-an-ip"));
});

Deno.test("http:// and credentials are invalid_url", async () => {
  const s = spy(() => new Response("ok"));
  for (const u of ["http://example.com/x", "https://user:pw@example.com/x", "nope", "ftp://example.com"]) {
    const r = await postSafeWebhook(u, {}, { fetch: s.f, resolve: publicResolve });
    assert(!r.ok && r.code === "invalid_url" && !r.retryable, u);
  }
  assert(s.calls.length === 0);
});

Deno.test("literal IP hosts are blocked without DNS or fetch", async () => {
  const s = spy(() => new Response("ok"));
  let resolved = 0;
  const resolve = () => { resolved++; return Promise.resolve(["93.184.216.34"]); };
  for (const u of ["https://127.0.0.1/x", "https://[::1]/x", "https://[::ffff:10.0.0.1]/x", "https://localhost/x", "https://a.localhost/x", "https://db.internal/x"]) {
    const r = await postSafeWebhook(u, {}, { fetch: s.f, resolve });
    assert(!r.ok && r.code === "blocked_address" && !r.retryable, u);
  }
  assert(s.calls.length === 0 && resolved === 0);
});

Deno.test("resolver returning a blocked address (even among public ones) blocks without fetch", async () => {
  const s = spy(() => new Response("ok"));
  for (const addrs of [["169.254.169.254"], ["93.184.216.34", "10.0.0.5"], []]) {
    const r = await postSafeWebhook(URL_OK, {}, { fetch: s.f, resolve: () => Promise.resolve(addrs) });
    assert(!r.ok && r.code === "blocked_address", JSON.stringify(addrs));
  }
  assert(s.calls.length === 0);
});

Deno.test("resolver failure is retryable network_error", async () => {
  const r = await postSafeWebhook(URL_OK, {}, { fetch: spy(() => new Response("")).f, resolve: () => Promise.reject(new Error("dns")) });
  assert(!r.ok && r.code === "network_error" && r.retryable);
});

Deno.test("302 is not followed and is a non-retryable http_error", async () => {
  const s = spy(() => new Response(null, { status: 302, headers: { location: "http://192.168.0.1/" } }));
  const r = await postSafeWebhook(URL_OK, { a: 1 }, { fetch: s.f, resolve: publicResolve });
  assert(!r.ok && r.code === "http_error" && !r.retryable);
  assert(s.calls.length === 1 && s.calls[0].init?.redirect === "manual");
});

Deno.test("200 is ok and request is JSON POST with user agent", async () => {
  const s = spy(() => new Response("{}", { status: 200 }));
  const r = await postSafeWebhook(URL_OK, { a: 1 }, { fetch: s.f, resolve: publicResolve });
  assert(r.ok && r.status === 200);
  const init = s.calls[0].init!; const h = new Headers(init.headers);
  assert(init.method === "POST" && init.body === '{"a":1}' && init.signal);
  assert(h.get("content-type") === "application/json" && h.get("user-agent") === "FlowAI-Webhook/1");
});

Deno.test("503 and 429 are retryable, 400 is not", async () => {
  for (const [status, retryable] of [[503, true], [500, true], [429, true], [400, false], [404, false]] as const) {
    const r = await postSafeWebhook(URL_OK, {}, { fetch: spy(() => new Response("x", { status })).f, resolve: publicResolve });
    assert(!r.ok && r.code === "http_error" && r.retryable === retryable, String(status));
  }
});

Deno.test("response body over 64 KB is too_large", async () => {
  const big = new Uint8Array(64 * 1024 + 1);
  const r = await postSafeWebhook(URL_OK, {}, { fetch: spy(() => new Response(big, { status: 200 })).f, resolve: publicResolve });
  assert(!r.ok && r.code === "too_large" && !r.retryable);
  const exact = await postSafeWebhook(URL_OK, {}, { fetch: spy(() => new Response(new Uint8Array(64 * 1024), { status: 200 })).f, resolve: publicResolve });
  assert(exact.ok);
});

Deno.test("timeout is retryable", async () => {
  const f = ((_i: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
  })) as typeof fetch;
  const r = await postSafeWebhook(URL_OK, {}, { fetch: f, resolve: publicResolve, timeoutMs: 20 });
  assert(!r.ok && r.code === "timeout" && r.retryable);
});

Deno.test("network error is retryable", async () => {
  const f = (() => Promise.reject(new TypeError("conn"))) as typeof fetch;
  const r = await postSafeWebhook(URL_OK, {}, { fetch: f, resolve: publicResolve });
  assert(!r.ok && r.code === "network_error" && r.retryable);
});

Deno.test("fix1: translated IPv6 (NAT64, SIIT, 6to4, Teredo) cannot reach private IPv4", async () => {
  for (const ip of ["64:ff9b::a00:1", "64:ff9b::10.0.0.1", "64:ff9b:1::a00:1", "::ffff:0:a00:1", "2002:a00:1::1", "2002:7f00:1::", "2001:0:4136:e378:8000:63bf:3fff:fdd2"]) assert(isBlockedAddress(ip), ip);
  for (const ip of ["64:ff9b::8.8.8.8", "64:ff9b::808:808", "2002:808:808::1", "::ffff:0:808:808"]) assert(!isBlockedAddress(ip), ip);
  const s = spy(() => new Response("ok"));
  const r = await postSafeWebhook("https://[64:ff9b::10.0.0.1]/x", {}, { fetch: s.f, resolve: publicResolve });
  assert(!r.ok && r.code === "blocked_address" && s.calls.length === 0);
  for (const a of ["64:ff9b:1::a00:1", "::ffff:0:a00:1", "2002:a00:1::1"]) {
    const x = await postSafeWebhook(URL_OK, {}, { fetch: s.f, resolve: () => Promise.resolve([a]) });
    assert(!x.ok && x.code === "blocked_address", a);
  }
  const ok = await postSafeWebhook(URL_OK, {}, { fetch: s.f, resolve: () => Promise.resolve(["64:ff9b::8.8.8.8"]) });
  assert(ok.ok);
});

Deno.test("fix2/3: site-local, multicast, discard, documentation and extra IPv4 ranges are blocked", () => {
  for (const ip of ["fec0::1", "feff::1", "ff02::1", "ff00::", "100::1", "2001:db8::1", "198.18.0.1", "198.19.255.255", "192.0.0.5", "192.0.2.1", "198.51.100.7", "203.0.113.9"]) assert(isBlockedAddress(ip), ip);
  for (const ip of ["100:0:0:1::1", "2001:db9::1", "198.20.0.1", "192.0.1.1", "2a00:1450::1"]) assert(!isBlockedAddress(ip), ip);
});

Deno.test("fix3: alternate IPv4 literal forms, IPv4-compatible and AAAA-only blocked", async () => {
  const s = spy(() => new Response("ok"));
  for (const u of ["https://2130706433/x", "https://0x7f.0.0.1/x", "https://[::127.0.0.1]/x", "https://localhost../x", "https://a.internal../x"]) {
    const r = await postSafeWebhook(u, {}, { fetch: s.f, resolve: publicResolve });
    assert(!r.ok && r.code === "blocked_address", u);
  }
  const r = await postSafeWebhook(URL_OK, {}, { fetch: s.f, resolve: () => Promise.resolve(["fd00::1"]) });
  assert(!r.ok && r.code === "blocked_address" && s.calls.length === 0);
});

Deno.test("fix3: DNS resolution is under the timeout", async () => {
  const s = spy(() => new Response("ok"));
  const r = await postSafeWebhook(URL_OK, {}, { fetch: s.f, resolve: () => new Promise(() => {}), timeoutMs: 20 });
  assert(!r.ok && r.code === "timeout" && r.retryable && s.calls.length === 0);
});

Deno.test("fix3: unserializable body is non-retryable invalid_body", async () => {
  const s = spy(() => new Response("ok"));
  const cyc: Record<string, unknown> = {}; cyc.self = cyc;
  for (const b of [cyc, 10n, undefined]) {
    const r = await postSafeWebhook(URL_OK, b, { fetch: s.f, resolve: publicResolve });
    assert(!r.ok && r.code === "invalid_body" && !r.retryable);
  }
  assert(s.calls.length === 0);
});
