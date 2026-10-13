import { describe, expect, it } from "vitest";
import {
  agentConfigSchema,
  classificationSchema,
  knowledgeDocumentSchema,
  playgroundInputSchema,
  replyOutputSchema,
} from "./schemas.ts";
import { AIProviderError } from "./types.ts";

const validClassification = {
  intent: "pedir_preco",
  sentiment: "neutral",
  lead_score: 50,
  needs_human: false,
  summary: "Cliente quer saber o preço.",
  suggested_stage: null,
};

const validAgent = {
  name: "Ana",
  personality: "Simpática",
  objective: "Vender",
  tone: "Amigável",
  systemPrompt: "Você é a Ana.",
  isActive: true,
  autoReply: true,
  humanHandoff: true,
};

describe("classificationSchema", () => {
  it("accepts a valid classification", () => {
    expect(classificationSchema.safeParse(validClassification).success).toBe(true);
    expect(classificationSchema.safeParse({ ...validClassification, suggested_stage: "Novo" }).success).toBe(true);
  });
  it("rejects out-of-range score and unknown sentiment", () => {
    expect(classificationSchema.safeParse({ ...validClassification, lead_score: 101 }).success).toBe(false);
    expect(classificationSchema.safeParse({ ...validClassification, sentiment: "angry" }).success).toBe(false);
  });
});

describe("replyOutputSchema", () => {
  it("validates reply output", () => {
    const ok = { reply: "Olá", used_chunk_ids: [], needs_human: false, handoff_reason: null };
    expect(replyOutputSchema.safeParse(ok).success).toBe(true);
    expect(replyOutputSchema.safeParse({ ...ok, reply: "a".repeat(2001) }).success).toBe(false);
  });
});

describe("agentConfigSchema", () => {
  it("accepts a valid config", () => {
    expect(agentConfigSchema.safeParse(validAgent).success).toBe(true);
  });
  it("rejects a 8001-char systemPrompt and a blank name", () => {
    expect(agentConfigSchema.safeParse({ ...validAgent, systemPrompt: "a".repeat(8001) }).success).toBe(false);
    expect(agentConfigSchema.safeParse({ ...validAgent, name: "   " }).success).toBe(false);
  });
});

describe("knowledgeDocumentSchema", () => {
  it("rejects blank and oversized content", () => {
    expect(knowledgeDocumentSchema.safeParse({ title: "Doc", content: "texto" }).success).toBe(true);
    expect(knowledgeDocumentSchema.safeParse({ title: "Doc", content: "   " }).success).toBe(false);
    expect(knowledgeDocumentSchema.safeParse({ title: "Doc", content: "a".repeat(200001) }).success).toBe(false);
  });
});

describe("playgroundInputSchema", () => {
  const msg = (role: "contact" | "ai", text = "oi") => ({ role, text });
  it("accepts a list ending with contact", () => {
    expect(playgroundInputSchema.safeParse({ messages: [msg("contact")] }).success).toBe(true);
  });
  it("rejects 11 messages and a list ending with ai", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => msg(i % 2 === 0 ? "contact" : "ai"));
    expect(playgroundInputSchema.safeParse({ messages: eleven }).success).toBe(false);
    expect(playgroundInputSchema.safeParse({ messages: [msg("contact"), msg("ai")] }).success).toBe(false);
  });
});

describe("AIProviderError", () => {
  it("derives retryable from the code", () => {
    expect(new AIProviderError("rate_limited").retryable).toBe(true);
    expect(new AIProviderError("unavailable").retryable).toBe(true);
    expect(new AIProviderError("invalid_response").retryable).toBe(true);
    expect(new AIProviderError("not_configured").retryable).toBe(false);
    expect(new AIProviderError("rejected").retryable).toBe(false);
  });
});
