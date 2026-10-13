export type FakeCall = { status?: number; body?: unknown; throws?: boolean };
// deno-lint-ignore no-explicit-any
export type FakeScript = { onCall?(index: number, path: string, body: any): FakeCall | undefined };
// deno-lint-ignore no-explicit-any
export type FakeOpenAIFetch = typeof fetch & { calls: { path: string; body: any }[] };

const DIMS = 1536;
function words(text: string): string[] {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
}
function hash(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) { h ^= word.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % DIMS;
}
export function fakeEmbedding(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const w of words(text)) v[hash(w)] += 1;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

// Depends on the knowledge block format of packages/core/src/ai/prompt.ts (knowledgeBlock): "[id] title" then the content on the next line.
function firstHit(system: string): { id: string; content: string } | null {
  const block = /<knowledge>\n([\s\S]*?)\n<\/knowledge>/.exec(system)?.[1] ?? "";
  const match = /^\[([^\]]+)\] [^\n]*\n([^\n]*)/.exec(block);
  return match ? { id: match[1], content: match[2] } : null;
}

export function createFakeOpenAIFetch(script: FakeScript = {}): FakeOpenAIFetch {
  // deno-lint-ignore no-explicit-any
  const calls: { path: string; body: any }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^.*\/v1/, "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    const index = calls.length;
    calls.push({ path, body });
    const forced = script.onCall?.(index, path, body);
    if (forced?.throws) throw new Error("network");
    if (forced?.status && forced.status !== 200) return new Response(JSON.stringify({ error: "forced" }), { status: forced.status });
    if (forced?.body !== undefined) return Response.json(forced.body);
    if (path === "/embeddings") {
      const inputs: string[] = body.input;
      return Response.json({ data: inputs.map((text, i) => ({ index: i, embedding: fakeEmbedding(text) })).reverse() });
    }
    const name = body.response_format?.json_schema?.name;
    let output: unknown;
    if (name === "classification") output = { intent: "duvida", sentiment: "neutral", lead_score: 50, needs_human: false, summary: "Cliente com dúvida", suggested_stage: null };
    else if (name === "reply") {
      const hit = firstHit(String(body.messages?.[0]?.content ?? ""));
      output = hit
        ? { reply: (hit.content.split(/(?<=[.!?])\s/)[0] ?? hit.content).trim(), used_chunk_ids: [hit.id], needs_human: false, handoff_reason: null }
        : { reply: "", used_chunk_ids: [], needs_human: true, handoff_reason: "Sem informação" };
    } else output = "ok";
    return Response.json({ choices: [{ message: { content: typeof output === "string" ? output : JSON.stringify(output) } }] });
  }) as FakeOpenAIFetch;
  fake.calls = calls;
  return fake;
}
