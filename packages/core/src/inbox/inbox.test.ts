import { describe, expect, it } from "vitest";
import { formatDaySeparator, formatRelativeTime, isUnread, parseInboxParams } from "./index.ts";

const TZ = "America/Sao_Paulo";
const now = new Date("2026-10-10T15:00:00Z");

describe("parseInboxParams", () => {
  it("defaults and validates", () => {
    expect(parseInboxParams({ aba: "x", c: "nao-uuid" })).toMatchObject({ tab: "todas", conversationId: null, q: "", channelId: null });
    const id = "6f1c1e0e-3b0e-4a57-9c1a-2f0f5d1b7a11";
    expect(parseInboxParams({ aba: "minhas", c: id, canal: id, q: "ana" })).toEqual({ tab: "minhas", conversationId: id, q: "ana", channelId: id });
    expect(parseInboxParams({ q: "a".repeat(200) }).q).toHaveLength(100);
    expect(parseInboxParams({ aba: ["fechadas"] }).tab).toBe("fechadas");
  });
});

describe("isUnread", () => {
  it("compares timestamps", () => {
    expect(isUnread({ lastInboundAt: "2026-10-10T10:00:00Z", lastReadAt: "2026-10-10T09:00:00Z" })).toBe(true);
    expect(isUnread({ lastInboundAt: "2026-10-10T10:00:00Z", lastReadAt: null })).toBe(true);
    expect(isUnread({ lastInboundAt: "2026-10-10T09:00:00Z", lastReadAt: "2026-10-10T10:00:00Z" })).toBe(false);
    expect(isUnread({ lastInboundAt: null, lastReadAt: null })).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  it("formats", () => {
    expect(formatRelativeTime("2026-10-10T14:59:40Z", now, TZ)).toBe("agora");
    expect(formatRelativeTime("2026-10-10T14:50:00Z", now, TZ)).toBe("10 min");
    expect(formatRelativeTime("2026-10-10T12:00:00Z", now, TZ)).toBe("09:00");
    expect(formatRelativeTime("2026-10-09T15:00:00Z", now, TZ)).toBe("ontem");
    expect(formatRelativeTime("2026-03-05T15:00:00Z", now, TZ)).toBe("05/03");
    expect(formatRelativeTime("2025-03-05T15:00:00Z", now, TZ)).toBe("05/03/2025");
  });
  it("honors timezone for day boundaries", () => {
    // 02:00Z on 10/10 is 23:00 on 09/10 in Sao Paulo -> ontem
    expect(formatRelativeTime("2026-10-10T02:00:00Z", now, TZ)).toBe("ontem");
  });
});

describe("formatDaySeparator", () => {
  it("formats", () => {
    expect(formatDaySeparator("2026-10-10T13:00:00Z", now, TZ)).toBe("Hoje");
    expect(formatDaySeparator("2026-10-09T13:00:00Z", now, TZ)).toBe("Ontem");
    expect(formatDaySeparator("2026-10-01T13:00:00Z", now, TZ)).toBe("01/10/2026");
  });
});
