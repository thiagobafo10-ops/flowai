import { describe, expect, it } from "vitest";
import { HANDOFF_LABELS, decideHandoff } from "./handoff.ts";
import type { Classification, ReplyOutput } from "./schemas.ts";

const cls = (needs_human: boolean): Classification => ({
  intent: "x", sentiment: "neutral", lead_score: 10, needs_human, summary: "", suggested_stage: null,
});
const rep = (needs_human: boolean, reason: string | null = null): ReplyOutput => ({
  reply: "oi", used_chunk_ids: [], needs_human, handoff_reason: reason,
});
const base = { injection: false, classification: cls(false), reply: rep(false), hitCount: 2, factCheck: { ok: true } };

describe("decideHandoff", () => {
  it("injection first", () => {
    expect(decideHandoff({ ...base, injection: true, classification: cls(true) })).toEqual({ handoff: true, reason: "injection" });
  });
  it("classification needs_human", () => {
    expect(decideHandoff({ ...base, classification: cls(true) })).toMatchObject({ handoff: true, reason: "needs_human" });
  });
  it("reply needs_human without hits -> no_knowledge with detail", () => {
    expect(decideHandoff({ ...base, hitCount: 0, reply: rep(true, "sem info") })).toEqual({ handoff: true, reason: "no_knowledge", detail: "sem info" });
  });
  it("reply needs_human with hits -> needs_human", () => {
    expect(decideHandoff({ ...base, reply: rep(true, "quer humano") })).toMatchObject({ handoff: true, reason: "needs_human" });
  });
  it("too long", () => {
    expect(decideHandoff({ ...base, replyBytes: 1001, maxReplyBytes: 1000 })).toMatchObject({ reason: "reply_too_long" });
  });
  it("unverified fact", () => {
    expect(decideHandoff({ ...base, factCheck: { ok: false } })).toMatchObject({ reason: "unverified_fact" });
  });
  it("all ok", () => {
    expect(decideHandoff(base)).toEqual({ handoff: false });
  });
  it("labels", () => {
    expect(HANDOFF_LABELS.window_closed).toBe("Fora da janela de 24h do Instagram");
  });
});
