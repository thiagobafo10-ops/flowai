import type { z } from "zod";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatOptions = { model?: string; temperature?: number; maxTokens?: number };

export interface AIProvider {
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
  structured<T>(messages: ChatMessage[], schema: z.ZodType<T>, opts: ChatOptions & { name: string }): Promise<T>;
  embed(texts: string[]): Promise<number[][]>;
}

export type AIErrorCode = "not_configured" | "rate_limited" | "unavailable" | "invalid_response" | "rejected";

const RETRYABLE: ReadonlySet<AIErrorCode> = new Set(["rate_limited", "unavailable", "invalid_response"]);

export class AIProviderError extends Error {
  readonly code: AIErrorCode;
  readonly retryable: boolean;
  constructor(code: AIErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AIProviderError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }
}

export type KnowledgeHit = { id: string; documentTitle: string; content: string; similarity: number };
