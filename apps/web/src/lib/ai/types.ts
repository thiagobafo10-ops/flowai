export type PlaygroundMessage = { role: "contact" | "ai"; text: string };

export type PlaygroundResult = {
  reply: string;
  classification: { intent: string; sentiment: "positive" | "neutral" | "negative"; lead_score: number } | null;
  hits: { id: string; documentTitle: string; content: string; similarity: number }[];
  usedChunkIds: string[];
  factCheck: { ok: boolean; unverified: string[] };
  decision: { handoff: boolean; reason?: string; label?: string; detail?: string };
};

export type AiAgentRow = {
  name: string;
  personality: string;
  objective: string;
  tone: string;
  systemPrompt: string;
  isActive: boolean;
  autoReply: boolean;
  humanHandoff: boolean;
};

export type AiQuota = { replies: number; repliesLimit: number; tests: number; testsLimit: number };
export type AiAgentPayload = { agent: AiAgentRow | null; quota: AiQuota; documentsReady: number; canWrite: boolean };
