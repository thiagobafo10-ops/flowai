import { verifyFacts } from "./facts.ts";
import { decideHandoff, type HandoffDecision } from "./handoff.ts";
import { detectInjection } from "./injection.ts";
import { buildClassificationMessages, buildReplyMessages, type PromptInput } from "./prompt.ts";
import { classificationSchema, replyOutputSchema, type Classification, type ReplyOutput } from "./schemas.ts";
import { AIProviderError, type AIProvider, type KnowledgeHit } from "./types.ts";

export type PipelineInput = PromptInput & { channelType: "simulator" | "instagram" };
export type PipelineDeps = {
  provider: AIProvider;
  searchKnowledge(embedding: number[]): Promise<KnowledgeHit[]>;
  chatModel: string;
};
export type PipelineResult = {
  classification: Classification | null;
  hits: KnowledgeHit[];
  reply: string | null;
  usedChunkIds: string[];
  factCheck: { ok: boolean; unverified: string[] } | null;
  decision: HandoffDecision;
};

const MAX_REPLY_BYTES = { instagram: 1000, simulator: 4096 } as const;
const EMBED_CONTACT_TURNS = 3;

export async function runReplyPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const contactTexts = input.conversation.filter((t) => t.role === "contact").map((t) => t.text);
  const lastTurn = input.conversation[input.conversation.length - 1];

  if (lastTurn?.role === "contact" && detectInjection(lastTurn.text)) {
    return {
      classification: null,
      hits: [],
      reply: null,
      usedChunkIds: [],
      factCheck: null,
      decision: decideHandoff({ injection: true, classification: null, reply: null, hitCount: 0, factCheck: null }),
    };
  }

  const classification = await deps.provider.structured(buildClassificationMessages(input), classificationSchema, {
    name: "classification",
    model: deps.chatModel,
    temperature: 0,
  });

  const query = contactTexts.slice(-EMBED_CONTACT_TURNS).join("\n") || (lastTurn?.text ?? "");
  const [embedding] = await deps.provider.embed([query]);
  if (!embedding || embedding.length === 0) throw new AIProviderError("invalid_response");
  const hits = await deps.searchKnowledge(embedding);

  const output: ReplyOutput = await deps.provider.structured(buildReplyMessages(input, hits, input.channelType), replyOutputSchema, {
    name: "reply",
    model: deps.chatModel,
    temperature: 0.2,
  });

  const hitIds = new Set(hits.map((h) => h.id));
  const usedChunkIds = [...new Set(output.used_chunk_ids.filter((id) => hitIds.has(id)))];
  const usedHits = hits.filter((h) => usedChunkIds.includes(h.id));
  const factCheck = verifyFacts(output.reply, [...usedHits.map((h) => h.content), input.company]);

  const decision = decideHandoff({
    injection: false,
    classification,
    reply: output,
    hitCount: hits.length,
    factCheck,
    replyBytes: new TextEncoder().encode(output.reply).length,
    maxReplyBytes: MAX_REPLY_BYTES[input.channelType],
  });

  return { classification, hits, reply: output.reply, usedChunkIds, factCheck, decision };
}
