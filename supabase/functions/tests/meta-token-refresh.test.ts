import { handleMetaTokenRefresh, type MetaTokenRefreshDeps, type TokenCandidate } from "../meta-token-refresh/handler.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }

const REFRESH = "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token";
const channel = "00000000-0000-4000-8000-000000000059";
const other = "00000000-0000-4000-8000-000000000060";
function fixture(fetcher: typeof fetch) {
  const records: unknown[][] = [];
  const logs: string[] = [];
  const sleeps: number[] = [];
  const calls: { url: string; method: string; authorization: string | null }[] = [];
  const candidates: TokenCandidate[] = [{ channelId: channel, generation: 3, accessToken: "old-secret-token", apiVersion: "v26.0" }];
  const deps: MetaTokenRefreshDeps = {
    readWorkerSecret: async () => "worker-secret-0123456789abcdef0123456789",
    candidates: async () => candidates,
    record: async (...args) => { records.push(args); },
    fetch: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", authorization: new Headers(init?.headers).get("authorization") });
      return await fetcher(input, init);
    },
    log: (...args) => { logs.push(args.map(String).join(" ")); },
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => new Date(),
  };
  const request = (secret = "worker-secret-0123456789abcdef0123456789") => new Request("http://local/meta-token-refresh", {
    method: "POST", headers: { "Content-Type": "application/json", "X-FlowAI-Worker": secret }, body: "{}",
  });
  return { deps, records, logs, sleeps, calls, candidates, request };
}
const renewed = async () => Response.json({ access_token: "new-secret-token", token_type: "bearer", expires_in: 5183944 });

Deno.test("renews the token through the documented access_token query parameter and records it with the same generation", async () => {
  const f = fixture(renewed);
  const response = await handleMetaTokenRefresh(f.request(), f.deps);
  assert(response.status === 200);
  assert(JSON.stringify(await response.json()) === '{"refreshed":1,"failed":0}');
  assert(f.calls.length === 1);
  assert(f.calls[0]!.url === `${REFRESH}&access_token=old-secret-token`, f.calls[0]!.url);
  assert(f.calls[0]!.method === "GET" && f.calls[0]!.authorization === null);
  assert(JSON.stringify(f.records) === JSON.stringify([[channel, 3, "new-secret-token", 5183944, null]]));
  assert(!f.logs.join("\n").includes("old-secret-token") && !f.logs.join("\n").includes("access_token"));
});

Deno.test("the token is URL-encoded in the query parameter", async () => {
  const f = fixture(renewed); f.candidates[0]!.accessToken = "a+b/c=d&e";
  await handleMetaTokenRefresh(f.request(), f.deps);
  assert(f.calls[0]!.url === `${REFRESH}&access_token=a%2Bb%2Fc%3Dd%26e`, f.calls[0]!.url);
});

Deno.test("Meta error 190 records invalid_token", async () => {
  const f = fixture(async () => Response.json({ error: { code: 190, message: "old-secret-token is invalid" } }, { status: 400 }));
  const response = await handleMetaTokenRefresh(f.request(), f.deps);
  assert(response.status === 200);
  assert(JSON.stringify(f.records) === JSON.stringify([[channel, 3, null, null, "invalid_token"]]));
});

Deno.test("timeouts, other errors and malformed replies record token_refresh_failed", async () => {
  for (const fetcher of [
    async () => { throw new DOMException("timed out", "TimeoutError"); },
    async () => Response.json({ error: { code: 4, message: "rate" } }, { status: 400 }),
    async () => Response.json({ access_token: "", expires_in: 10 }),
    async () => Response.json({ access_token: "x", expires_in: -1 }),
    async () => new Response("not json"),
  ] as (typeof fetch)[]) {
    const f = fixture(fetcher);
    const response = await handleMetaTokenRefresh(f.request(), f.deps);
    assert(response.status === 200);
    assert(JSON.stringify(f.records) === JSON.stringify([[channel, 3, null, null, "token_refresh_failed"]]), JSON.stringify(f.records));
  }
});

Deno.test("invalid internal secret returns 401 without reading candidates", async () => {
  const f = fixture(async () => Response.json({}));
  let read = 0; f.deps.candidates = async () => { read++; return []; };
  assert((await handleMetaTokenRefresh(f.request("wrong"), f.deps)).status === 401);
  assert((await handleMetaTokenRefresh(new Request("http://local/meta-token-refresh", { method: "POST" }), f.deps)).status === 401);
  f.deps.readWorkerSecret = async () => null;
  assert((await handleMetaTokenRefresh(f.request(), f.deps)).status === 401);
  assert((await handleMetaTokenRefresh(new Request("http://local/meta-token-refresh"), f.deps)).status === 405);
  assert(read === 0 && f.calls.length === 0);
});

Deno.test("a single transient record failure still saves the renewed token", async () => {
  const f = fixture(renewed);
  let attempts = 0;
  f.deps.record = async (...args) => { if (++attempts === 1) throw new Error("db"); f.records.push(args); };
  const response = await handleMetaTokenRefresh(f.request(), f.deps);
  assert(JSON.stringify(await response.json()) === '{"refreshed":1,"failed":0}');
  assert(JSON.stringify(f.records) === JSON.stringify([[channel, 3, "new-secret-token", 5183944, null]]));
  assert(JSON.stringify(f.sleeps) === "[1000]", JSON.stringify(f.sleeps));
});

Deno.test("a persistently failing record gives up after 3 attempts and the other channels continue", async () => {
  const f = fixture(renewed);
  f.candidates.push({ channelId: other, generation: 1, accessToken: "other-secret-token", apiVersion: "v26.0" });
  let attempts = 0;
  f.deps.record = async (...args) => { if (args[0] === channel) { attempts++; throw new Error("db"); } f.records.push(args); };
  const response = await handleMetaTokenRefresh(f.request(), f.deps);
  assert(JSON.stringify(await response.json()) === '{"refreshed":1,"failed":1}');
  assert(attempts === 3 && JSON.stringify(f.sleeps) === "[1000,3000]", `${attempts} ${JSON.stringify(f.sleeps)}`);
  assert(f.records.length === 1 && f.records[0]![0] === other);
});

Deno.test("failure codes are not retried", async () => {
  const f = fixture(async () => { throw new Error("network"); });
  let attempts = 0;
  f.deps.record = async () => { attempts++; throw new Error("db"); };
  await handleMetaTokenRefresh(f.request(), f.deps);
  assert(attempts === 1 && f.sleeps.length === 0);
});

Deno.test("budget starts at request entry and is checked before fetching and before recording", async () => {
  let clock = 0;
  const f = fixture(async () => { clock += 3_000; return await renewed(); });
  f.deps.now = () => new Date(clock);
  f.deps.budgetMs = 3_000;
  f.deps.readWorkerSecret = async () => { clock += 500; return "worker-secret-0123456789abcdef0123456789"; };
  f.candidates.push({ channelId: other, generation: 1, accessToken: "other-secret-token", apiVersion: "v26.0" });
  let attempts = 0;
  f.deps.record = async (...args) => { if (++attempts === 1) throw new Error("db"); f.records.push(args); };
  const response = await handleMetaTokenRefresh(f.request(), f.deps);
  // 500 ms reading the secret + 3 s at Meta passes the 3 s deadline: the renewed token is still
  // recorded once (it would be lost otherwise), no retry is scheduled and the second channel is never fetched.
  assert(JSON.stringify(await response.json()) === '{"refreshed":0,"failed":1}');
  assert(f.calls.length === 1 && attempts === 1 && f.sleeps.length === 0);
  assert(f.logs.some((line) => line.includes("budget_exhausted")));

  clock = 0;
  const g = fixture(async () => { clock += 5_000; throw new Error("timeout"); });
  g.deps.now = () => new Date(clock); g.deps.budgetMs = 3_000;
  await handleMetaTokenRefresh(g.request(), g.deps);
  assert(g.records.length === 0, "a failure code is not recorded after the deadline");
});

Deno.test("no log line or response contains a token or the refresh URL", async () => {
  const outputs: string[] = [];
  for (const fetcher of [
    renewed,
    async () => Response.json({ error: { code: 190, message: "old-secret-token" } }, { status: 400 }),
    async () => { throw new TypeError(`error sending request for url (${REFRESH}&access_token=old-secret-token)`); },
  ] as (typeof fetch)[]) {
    const f = fixture(fetcher);
    f.deps.record = async () => { throw new Error("db new-secret-token"); };
    outputs.push(await (await handleMetaTokenRefresh(f.request(), f.deps)).text(), ...f.logs);
    assert(f.logs.length > 0, "expected a log line per outcome");
  }
  const all = outputs.join("\n");
  assert(!all.includes("secret-token") && !all.includes("graph.instagram.com") && !all.includes("access_token"), all);
});
