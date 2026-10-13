import { z } from "zod";
import { createOpenAIProvider, toStrictJsonSchema } from "../_shared/openai.ts";
import { AIProviderError, classificationSchema, replyOutputSchema } from "../../../packages/core/src/ai/index.ts";
import { createFakeOpenAIFetch } from "./fake-openai.ts";
function assert(value: unknown, message = "assertion failed"): void { if (!value) throw new Error(message); }
async function code(promise: Promise<unknown>): Promise<AIProviderError> {
  try { await promise; } catch (e) { if (e instanceof AIProviderError) return e; throw e; }
  throw new Error("expected AIProviderError");
}
const msgs = [{ role: "user" as const, content: "oi" }];
const schema = z.object({ a: z.string() });

Deno.test("no api key throws not_configured without fetch", async () => {
  const f = createFakeOpenAIFetch(); const p = createOpenAIProvider({ apiKey: "", fetch: f });
  for (const run of [() => p.chat(msgs), () => p.structured(msgs, schema, { name: "x" }), () => p.embed(["a"])]) {
    const e = await code(run()); assert(e.code === "not_configured" && !e.retryable);
  }
  assert(f.calls.length === 0);
});
Deno.test("429 is rate_limited and retryable", async () => {
  const p = createOpenAIProvider({ apiKey: "k", fetch: createFakeOpenAIFetch({ onCall: () => ({ status: 429 }) }) });
  const e = await code(p.chat(msgs)); assert(e.code === "rate_limited" && e.retryable);
});
Deno.test("503 and network failures are unavailable", async () => {
  const p = createOpenAIProvider({ apiKey: "k", fetch: createFakeOpenAIFetch({ onCall: () => ({ status: 503 }) }) });
  assert((await code(p.chat(msgs))).code === "unavailable");
  const q = createOpenAIProvider({ apiKey: "k", fetch: createFakeOpenAIFetch({ onCall: () => ({ throws: true }) }) });
  assert((await code(q.chat(msgs))).code === "unavailable");
});
Deno.test("400/401/403 are rejected and not retryable", async () => {
  for (const status of [400, 401, 403]) {
    const p = createOpenAIProvider({ apiKey: "k", fetch: createFakeOpenAIFetch({ onCall: () => ({ status }) }) });
    const e = await code(p.chat(msgs)); assert(e.code === "rejected" && !e.retryable, String(status));
  }
});
Deno.test("JSON outside the schema is invalid_response (RF3)", async () => {
  const body = { choices: [{ message: { content: JSON.stringify({ a: 1 }) } }] };
  const p = createOpenAIProvider({ apiKey: "k", fetch: createFakeOpenAIFetch({ onCall: () => ({ body }) }) });
  const e = await code(p.structured(msgs, schema, { name: "x" })); assert(e.code === "invalid_response" && e.retryable);
  const bad = { choices: [{ message: { content: "not json" } }] };
  const q = createOpenAIProvider({ apiKey: "k", fetch: createFakeOpenAIFetch({ onCall: () => ({ body: bad }) }) });
  assert((await code(q.structured(msgs, schema, { name: "x" }))).code === "invalid_response");
});
Deno.test("structured sends strict json_schema with all properties required", async () => {
  for (const [name, s] of [["classification", classificationSchema], ["reply", replyOutputSchema]] as const) {
    const f = createFakeOpenAIFetch(); const p = createOpenAIProvider({ apiKey: "k", chatModel: "m", fetch: f });
    await p.structured(msgs, s as z.ZodType<unknown>, { name });
    const rf = f.calls[0].body.response_format; assert(rf.type === "json_schema" && rf.json_schema.strict === true && rf.json_schema.name === name);
    const sent = rf.json_schema.schema; assert(sent.additionalProperties === false);
    assert(JSON.stringify([...sent.required].sort()) === JSON.stringify(Object.keys(sent.properties).sort()));
    assert(f.calls[0].body.model === "m");
  }
  // deno-lint-ignore no-explicit-any
  const nullable = toStrictJsonSchema(z.toJSONSchema(classificationSchema)) as any;
  assert(JSON.stringify(nullable.properties.suggested_stage).includes('"null"'));
});
Deno.test("embed returns vectors in index order", async () => {
  const f = createFakeOpenAIFetch(); const p = createOpenAIProvider({ apiKey: "k", fetch: f });
  const out = await p.embed(["gato", "cachorro"]);
  assert(out.length === 2 && out[0].length === 1536);
  assert(out[0].join() !== out[1].join());
  const again = await p.embed(["gato"]); assert(again[0].join() === out[0].join());
  assert(f.calls[0].body.model === "text-embedding-3-small");
});
Deno.test("timeout while reading the body is unavailable", async () => {
  const hang = (async () => new Response(new ReadableStream({ start() { /* never closes */ } }), { status: 200 })) as typeof fetch;
  const p = createOpenAIProvider({ apiKey: "k", fetch: hang, timeoutMs: 20 });
  assert((await code(p.chat(msgs))).code === "unavailable");
});
