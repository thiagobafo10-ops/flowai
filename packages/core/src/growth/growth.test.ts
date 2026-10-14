import { describe, expect, it } from "vitest";
import {
  audienceFilterSchema,
  entryLinkInputSchema,
  generateLinkCode,
  instagramEntryLink,
  isExitWord,
  nextSendTime,
  outreachMessageSchema,
  sendWindowSchema,
  sequenceSettingsSchema,
  sequenceStepSchema,
  validateOutreachMessage,
} from "./index.ts";

const U1 = "3f1c2a4e-5b6d-4c8e-9a0b-1c2d3e4f5a6b";
const weekdays = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

describe("links", () => {
  it("generateLinkCode", () => {
    for (let i = 0; i < 50; i++) expect(generateLinkCode()).toMatch(/^[a-z0-9]{8}$/);
    expect(generateLinkCode(() => 0.999999)).toBe("99999999");
  });
  it("instagramEntryLink", () => {
    expect(instagramEntryLink("loja.x", "promo10")).toBe("https://ig.me/m/loja.x?ref=promo10");
  });
  it("entryLinkInputSchema", () => {
    expect(entryLinkInputSchema.safeParse({ name: " A ", channelId: U1, tagId: null }).success).toBe(true);
    expect(entryLinkInputSchema.safeParse({ name: "A", channelId: U1, code: "AB", tagId: null }).success).toBe(false);
    expect(entryLinkInputSchema.safeParse({ name: "A", channelId: U1, code: "a_b-1", tagId: U1 }).success).toBe(true);
    expect(entryLinkInputSchema.safeParse({ name: "", channelId: U1, tagId: null }).success).toBe(false);
  });
});

describe("outreach message", () => {
  const btn = (o: object) => ({ id: "a", title: "Ok", kind: "url", url: "https://x.com", ...o });
  it("buttons", () => {
    const ok = (m: object) => outreachMessageSchema.safeParse(m).success;
    expect(ok({ text: "oi", buttons: [btn({})] })).toBe(true);
    expect(ok({ text: "oi", buttons: ["a", "b", "c", "d"].map((id) => btn({ id })) })).toBe(false);
    expect(ok({ text: "oi", buttons: [btn({ kind: "automation", url: undefined })] })).toBe(false);
    expect(ok({ text: "oi", buttons: [btn({ kind: "automation", url: undefined, automationId: U1 })] })).toBe(true);
    expect(ok({ text: "oi", buttons: [btn({ url: "http://x.com" })] })).toBe(false);
    expect(ok({ text: "oi", buttons: [btn({})], quickReplies: [{ id: "b", title: "x", automationId: U1 }] })).toBe(false);
    expect(ok({ text: "oi", buttons: [btn({}), btn({})] })).toBe(false);
    expect(ok({ text: "oi", quickReplies: [{ id: "b", title: "x" }] })).toBe(false);
  });
  it("limits per channel", () => {
    const withBtn = (text: string) => outreachMessageSchema.parse({ text, buttons: [btn({})] });
    expect(validateOutreachMessage(withBtn("a".repeat(641)), "instagram")).not.toEqual([]);
    expect(validateOutreachMessage(withBtn("a".repeat(640)), "instagram")).toEqual([]);
    expect(validateOutreachMessage(outreachMessageSchema.parse({ text: "a".repeat(1001) }), "instagram")).not.toEqual([]);
    expect(validateOutreachMessage(outreachMessageSchema.parse({ text: "é".repeat(501) }), "instagram")).not.toEqual([]);
    expect(validateOutreachMessage(outreachMessageSchema.parse({ text: "a".repeat(4096) }), "simulator")).toEqual([]);
    expect(outreachMessageSchema.safeParse({ text: "a".repeat(4097) }).success).toBe(false);
  });
});

describe("window / step / settings", () => {
  it("sendWindow", () => {
    expect(sendWindowSchema.safeParse(weekdays).success).toBe(true);
    expect(sendWindowSchema.safeParse({ ...weekdays, start: "18:00" }).success).toBe(false);
    expect(sendWindowSchema.safeParse({ ...weekdays, days: [] }).success).toBe(false);
    expect(sendWindowSchema.safeParse({ ...weekdays, days: [1, 1] }).success).toBe(false);
  });
  it("step", () => {
    const message = { text: "oi" };
    expect(sequenceStepSchema.safeParse({ delayMinutes: 1, window: null, message }).success).toBe(true);
    expect(sequenceStepSchema.safeParse({ delayMinutes: 43200, window: null, message }).success).toBe(true);
    expect(sequenceStepSchema.safeParse({ delayMinutes: 43201, window: null, message }).success).toBe(false);
    expect(sequenceStepSchema.safeParse({ delayMinutes: 0, window: null, message }).success).toBe(false);
  });
  it("settings defaults", () => {
    const s = sequenceSettingsSchema.parse({ channelIds: [U1] });
    expect(s.exitOnReply).toBe(false);
    expect(s.exitWords).toEqual(["sair", "parar", "cancelar"]);
    expect(sequenceSettingsSchema.safeParse({ channelIds: [] }).success).toBe(false);
  });
});

describe("nextSendTime", () => {
  const SP = "America/Sao_Paulo";
  it("moves Friday 18:00 SP to Monday 09:00 SP", () => {
    expect(nextSendTime("2026-10-16T21:00:00Z", 1, weekdays, SP)).toBe("2026-10-19T12:00:00Z");
  });
  it("no window = from + delay", () => {
    expect(nextSendTime("2026-10-16T21:00:00Z", 90, null, SP)).toBe("2026-10-16T22:30:00Z");
  });
  it("inside the window is unchanged", () => {
    expect(nextSendTime("2026-10-14T13:00:00Z", 30, weekdays, SP)).toBe("2026-10-14T13:30:00Z");
  });
  it("before start moves to same-day start", () => {
    expect(nextSendTime("2026-10-14T10:00:00Z", 10, weekdays, SP)).toBe("2026-10-14T12:00:00Z");
  });
  it("end is exclusive", () => {
    expect(nextSendTime("2026-10-14T20:59:00Z", 1, weekdays, SP)).toBe("2026-10-15T12:00:00Z");
  });
  it("keeps 09:00 local across New York DST end (2026-11-01)", () => {
    const w = { days: [1, 2, 3, 4, 5, 6, 7], start: "09:00", end: "18:00" };
    expect(nextSendTime("2026-10-31T23:00:00Z", 1, w, "America/New_York")).toBe("2026-11-01T14:00:00Z");
    expect(nextSendTime("2026-10-30T23:00:00Z", 1, w, "America/New_York")).toBe("2026-10-31T13:00:00Z");
  });
});

describe("isExitWord", () => {
  const words = ["sair", "parar", "cancelar"];
  it("matches whole normalized message", () => {
    expect(isExitWord("Parar!", words)).toBe(true);
    expect(isExitWord("  SAIR ", words)).toBe(true);
    expect(isExitWord("não quero parar agora", words)).toBe(false);
    expect(isExitWord("...", words)).toBe(false);
    expect(isExitWord("Cancélar.", words)).toBe(true);
  });
});

describe("audience", () => {
  const base = { channelIds: [U1], tagsAll: [], tagsAny: [], tagsNone: [], stageIds: [], minLeadScore: null, lastInteractionDays: null, entryLinkIds: [] };
  it("requires channels and bounds", () => {
    expect(audienceFilterSchema.safeParse(base).success).toBe(true);
    expect(audienceFilterSchema.safeParse({ ...base, channelIds: [] }).success).toBe(false);
    expect(audienceFilterSchema.safeParse({ ...base, minLeadScore: 101 }).success).toBe(false);
    expect(audienceFilterSchema.safeParse({ ...base, lastInteractionDays: 0 }).success).toBe(false);
  });
});
