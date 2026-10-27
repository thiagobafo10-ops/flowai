import { handleMetaTokenRefresh, type MetaTokenRefreshDeps, type TokenCandidate } from "../meta-token-refresh/handler.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }

const channel = "00000000-0000-4000-8000-000000000059";
function fixture(fetcher: typeof fetch) {
  const records: unknown[][] = [];
  const logs: string[] = [];
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
    now: () => new Date(),
  };
  const request = (secret = "worker-secret-0123456789abcdef0123456789") => new Request("http://local/meta-token-refresh", {
    method: "POST", headers: { "Content-Type": "application/json", "X-FlowAI-Worker": secret }, body: "{}",
  });
  return { deps, records, logs, calls, candidates, request };
}

Deno.test("renews the token with the bearer header and records it with the same generation", async () => {
  const f = fixture(async () => Response.json({ access_token: "new-secret-token", token_type: "bearer", expires_in: 5183944 }));
  const response = await handleMetaTokenRefresh(f.request(), f.deps);
  assert(response.status === 200);
  assert(JSON.stringify(await response.json()) === '{"refreshed":1,"failed":0}');
  assert(f.calls.length === 1);
  assert(f.calls[0]!.url === "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token", f.calls[0]!.url);
  assert(f.calls[0]!.method === "GET");
  assert(f.calls[0]!.authorization === "Bearer old-secret-token");
  assert(JSON.stringify(f.records) === JSON.stringify([[channel, 3, "new-secret-token", 5183944, null]]));
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

Deno.test("a failing record does not stop the other channels", async () => {
  const f = fixture(async () => Response.json({ access_token: "new-secret-token", expires_in: 100 }));
  f.candidates.push({ channelId: "00000000-0000-4000-8000-000000000060", generation: 1, accessToken: "other-secret-token", apiVersion: "v26.0" });
  let first = true;
  f.deps.record = async (...args) => { if (first) { first = false; throw new Error("db"); } f.records.push(args); };
  const response = await handleMetaTokenRefresh(f.request(), f.deps);
  assert(response.status === 200);
  assert(f.records.length === 1 && f.records[0]![0] === "00000000-0000-4000-8000-000000000060");
});

Deno.test("no log line or response contains a token", async () => {
  const outputs: string[] = [];
  for (const fetcher of [
    async () => Response.json({ access_token: "new-secret-token", expires_in: 100 }),
    async () => Response.json({ error: { code: 190, message: "old-secret-token" } }, { status: 400 }),
    async () => { throw new Error("network old-secret-token"); },
  ] as (typeof fetch)[]) {
    const f = fixture(fetcher);
    f.deps.record = async () => { throw new Error("db new-secret-token"); };
    outputs.push(await (await handleMetaTokenRefresh(f.request(), f.deps)).text(), ...f.logs);
    assert(f.logs.length > 0, "expected a log line per outcome");
  }
  const all = outputs.join("\n");
  assert(!all.includes("secret-token") && !all.includes("graph.instagram.com"), all);
});
