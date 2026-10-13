import { z } from "zod";
import { AIProviderError, type AIProvider, type ChatMessage, type ChatOptions } from "../../../packages/core/src/ai/index.ts";

export type OpenAIOptions = { apiKey: string | undefined; baseUrl?: string; chatModel?: string; embeddingModel?: string; fetch: typeof fetch; timeoutMs?: number };

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const UNSUPPORTED_KEYWORDS = new Set(["$schema", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "pattern", "format", "default"]);

/** Adapts a Zod JSON Schema to OpenAI strict mode: every property required, no extra properties, no unsupported keywords. */
export function toStrictJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictJsonSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    out[key] = key === "properties" && value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, toStrictJsonSchema(child)]))
      : toStrictJsonSchema(value);
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}

export function createOpenAIProvider(opts: OpenAIOptions): AIProvider {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const defaultChat = opts.chatModel || "gpt-4.1-mini";
  const embeddingModel = opts.embeddingModel || "text-embedding-3-small";

  // deno-lint-ignore no-explicit-any
  async function post(path: string, body: unknown): Promise<any> {
    if (!opts.apiKey) throw new AIProviderError("not_configured");
    let response: Response;
    try {
      response = await opts.fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      });
    } catch { throw new AIProviderError("unavailable"); }
    if (response.status === 429) throw new AIProviderError("rate_limited");
    if (response.status >= 500) throw new AIProviderError("unavailable");
    if (!response.ok) throw new AIProviderError("rejected");
    try { return await response.json(); } catch { throw new AIProviderError("invalid_response"); }
  }

  function chatBody(messages: ChatMessage[], o: ChatOptions | undefined, extra: Record<string, unknown> = {}) {
    return { model: o?.model || defaultChat, messages, ...(o?.temperature !== undefined ? { temperature: o.temperature } : {}), ...(o?.maxTokens !== undefined ? { max_tokens: o.maxTokens } : {}), ...extra };
  }
  // deno-lint-ignore no-explicit-any
  function content(data: any): string {
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new AIProviderError("invalid_response");
    return text;
  }

  return {
    async chat(messages, o) { return content(await post("/chat/completions", chatBody(messages, o))); },
    async structured<T>(messages: ChatMessage[], schema: z.ZodType<T>, o: ChatOptions & { name: string }): Promise<T> {
      const jsonSchema = toStrictJsonSchema(z.toJSONSchema(schema));
      const text = content(await post("/chat/completions", chatBody(messages, o, { response_format: { type: "json_schema", json_schema: { name: o.name, strict: true, schema: jsonSchema } } })));
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new AIProviderError("invalid_response"); }
      const result = schema.safeParse(parsed);
      if (!result.success) throw new AIProviderError("invalid_response");
      return result.data;
    },
    async embed(texts) {
      const data = await post("/embeddings", { model: embeddingModel, input: texts });
      const rows = data?.data;
      if (!Array.isArray(rows) || rows.length !== texts.length) throw new AIProviderError("invalid_response");
      const sorted = [...rows].sort((a, b) => a.index - b.index);
      if (sorted.some((row, i) => row.index !== i || !Array.isArray(row.embedding))) throw new AIProviderError("invalid_response");
      return sorted.map((row) => row.embedding as number[]);
    },
  };
}
