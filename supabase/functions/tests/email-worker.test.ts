import { handleEmailWorker, type ClaimedSend, type EmailWorkerDeps } from "../email-worker/handler.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }

const SECRET = "worker-secret-0123456789abcdef0123456789";
const KEY = "re_super_secret_key_123";
const SEND = "00000000-0000-4000-8000-000000000001";
function claimed(category: "marketing" | "transactional" = "transactional"): ClaimedSend {
  return {
    sendId: SEND, toEmail: "cliente@example.com", category,
    content: { subject: "Oi {primeiro_nome}", heading: "Esqueceu algo?", body: "Volte", buttonLabel: "Finalizar", coupon: null },
    ctx: { storeName: "Loja", firstName: "Ana", name: "Ana Souza", total: 99.9, items: [], buttonUrl: "https://loja.example/c/1", unsubscribeToken: category === "marketing" ? "tok123" : null },
    from: "Loja <loja@example.com>", replyTo: "sac@example.com", resendKey: KEY,
  };
}
function fixture(reply: () => Response | Promise<Response>, sends: ClaimedSend[] = [claimed()]) {
  const completed: unknown[][] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  let claimedLimit = 0;
  const deps: EmailWorkerDeps = {
    readWorkerSecret: async () => SECRET,
    claim: async (limit) => { claimedLimit = limit; return sends; },
    complete: async (...args) => { completed.push(args); },
    fetch: async (input, init) => { calls.push({ url: String(input), init: init ?? {} }); return await reply(); },
    appUrl: "https://app.flowai.example", log: () => {},
  };
  const request = (secret = SECRET) => new Request("http://local/email-worker", { method: "POST", headers: { "X-FlowAI-Worker": secret }, body: "{}" });
  return { deps, completed, calls, request, limit: () => claimedLimit };
}

Deno.test("rejects requests without the internal worker secret", async () => {
  const f = fixture(() => Response.json({ id: "x" }));
  const response = await handleEmailWorker(new Request("http://local/email-worker", { method: "POST" }), f.deps);
  assert(response.status === 401);
  const wrong = await handleEmailWorker(f.request("nope"), f.deps);
  assert(wrong.status === 401 && f.limit() === 0 && f.calls.length === 0);
});

Deno.test("sends through Resend with the send id as idempotency key and completes as sent", async () => {
  const f = fixture(() => Response.json({ id: "resend-id-1" }));
  const response = await handleEmailWorker(f.request(), f.deps);
  assert(response.status === 200);
  assert(f.limit() === 50);
  assert(f.calls.length === 1 && f.calls[0]!.url === "https://api.resend.com/emails");
  const headers = new Headers(f.calls[0]!.init.headers);
  assert(headers.get("authorization") === `Bearer ${KEY}`);
  assert(headers.get("idempotency-key") === SEND);
  const body = JSON.parse(String(f.calls[0]!.init.body));
  assert(body.from === "Loja <loja@example.com>" && body.to[0] === "cliente@example.com" && body.reply_to === "sac@example.com");
  assert(body.subject === "Oi Ana" && body.html.includes("Esqueceu algo?") && typeof body.text === "string");
  assert(body.headers === undefined && !body.html.includes("/e/sair/"), "transactional has no unsubscribe");
  assert(JSON.stringify(f.completed) === JSON.stringify([[SEND, "sent", "resend-id-1", null]]), JSON.stringify(f.completed));
});

Deno.test("429 and network errors complete as retry; 422 completes as failed", async () => {
  const limited = fixture(() => new Response("{}", { status: 429 }));
  await handleEmailWorker(limited.request(), limited.deps);
  assert(limited.completed[0]![1] === "retry" && limited.completed[0]![2] === null, JSON.stringify(limited.completed));
  const invalid = fixture(() => new Response("{}", { status: 422 }));
  await handleEmailWorker(invalid.request(), invalid.deps);
  assert(invalid.completed[0]![1] === "failed" && invalid.completed[0]![3] === "http_422", JSON.stringify(invalid.completed));
  const down = fixture(() => { throw new TypeError("network"); });
  await handleEmailWorker(down.request(), down.deps);
  assert(down.completed[0]![1] === "retry", JSON.stringify(down.completed));
});

Deno.test("marketing carries both List-Unsubscribe headers and the unsubscribe link", async () => {
  const f = fixture(() => Response.json({ id: "r2" }), [claimed("marketing")]);
  await handleEmailWorker(f.request(), f.deps);
  const body = JSON.parse(String(f.calls[0]!.init.body));
  assert(body.headers["List-Unsubscribe"] === "<https://app.flowai.example/e/sair/tok123/one-click>", body.headers["List-Unsubscribe"]);
  assert(body.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click");
  assert(body.html.includes('https://app.flowai.example/e/sair/tok123"') && body.text.includes("https://app.flowai.example/e/sair/tok123"));
});

Deno.test("never logs the Resend key or the recipient", async () => {
  const seen: string[] = [];
  const original = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const name of Object.keys(original) as (keyof typeof original)[]) console[name] = (...args: unknown[]) => { seen.push(args.map(String).join(" ")); };
  try {
    const replies: (() => Response)[] = [() => Response.json({ id: "a" }), () => new Response(JSON.stringify({ message: KEY }), { status: 422 }), () => { throw new Error(KEY); }];
    for (const reply of replies) {
      const f = fixture(reply, [claimed("marketing")]); delete f.deps.log;
      await handleEmailWorker(f.request(), f.deps);
    }
  } finally { Object.assign(console, original); }
  assert(seen.length > 0, "expected some logs");
  assert(!seen.some((line) => line.includes(KEY) || line.includes("cliente@example.com")), seen.join("\n"));
});
