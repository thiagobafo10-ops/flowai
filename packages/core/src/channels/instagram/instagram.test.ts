import { describe, expect, it } from "vitest";
import { InstagramProvider, parseInstagramEvents } from "../index.ts";

const now = () => new Date("2026-10-12T12:00:00Z");
const inbound = (message: Record<string, unknown>) => ({ object: "instagram", entry: [{ id: "178414000000001", time: 1791806400, messaging: [{ sender: { id: "9001" }, recipient: { id: "178414000000001" }, timestamp: 1791806400000, message }] }] });

describe("Instagram webhook events", () => {
  it("normalizes a Direct without turning the professional account into the sender", () => {
    expect(parseInstagramEvents(inbound({ mid: "m1", text: "Olá" }))).toEqual([{ kind: "message", accountId: "178414000000001", externalId: "m1", senderExternalId: "9001", senderName: null, text: "Olá", occurredAt: "2026-10-12T12:00:00.000Z", context: { origin: "direct" } }]);
  });
  it("recognizes a story reply and retains its identifier", () => {
    expect(parseInstagramEvents(inbound({ mid: "m2", text: "Quero", reply_to: { story: { id: "s1", url: "https://cdn.example/story" } } }))[0]).toMatchObject({ kind: "message", context: { origin: "story_reply", storyId: "s1" } });
  });
  it("represents story mentions as an inbound message even without text", () => {
    expect(parseInstagramEvents(inbound({ mid: "m3", attachments: [{ type: "story_mention", payload: { url: "https://cdn.example/story" } }] }))[0]).toMatchObject({ kind: "message", text: "[Menção em story]", context: { origin: "story_mention", attachmentType: "story_mention" } });
  });
  it.each(["is_echo", "is_self", "is_deleted"])("ignores %s instead of creating an inbound", (flag) => {
    expect(parseInstagramEvents(inbound({ mid: "m4", text: "Olá", [flag]: true }))[0]).toMatchObject({ kind: "ignored" });
  });
  it("normalizes a comment independently of Direct", () => {
    const payload = { object: "instagram", entry: [{ id: "178414000000001", time: 1791806400, changes: [{ field: "comments", value: { id: "c1", from: { id: "9001", username: "cliente" }, text: "GUIA", media: { id: "p1", media_product_type: "REELS" } } }] }] };
    expect(parseInstagramEvents(payload)[0]).toEqual({ kind: "comment", accountId: "178414000000001", externalId: "c1", commentId: "c1", mediaId: "p1", mediaProductType: "REELS", senderExternalId: "9001", senderName: "cliente", text: "GUIA", occurredAt: "2026-10-12T12:00:00.000Z" });
  });
  it("accepts the documented entry-level comment shape", () => {
    expect(parseInstagramEvents({ object: "instagram", entry: [{ id: "178414000000001", time: 1791806400, field: "comments", value: { id: "c2", from: { id: "9001" }, text: "guia", media: { id: "p1" } } }] })[0]).toMatchObject({ kind: "comment", commentId: "c2" });
  });
  it("normalizes the messaging_seen receipt using the exact message ID", () => {
    expect(parseInstagramEvents({ object: "instagram", entry: [{ id: "178414000000001", messaging: [{ sender: { id: "9001" }, recipient: { id: "178414000000001" }, timestamp: 1791806400000, read: { mid: "out1" } }] }] })[0]).toMatchObject({ kind: "status", messageExternalId: "out1", state: "read" });
  });
  it("does not invent delivered receipts for unknown events", () => {
    expect(parseInstagramEvents({ object: "instagram", entry: [{ id: "178414000000001", time: 1791806400, changes: [{ field: "story_insights", value: {} }] }] })[0]).toMatchObject({ kind: "ignored" });
  });
  it("rejects malformed known messages instead of acknowledging lost data", () => {
    expect(() => parseInstagramEvents(inbound({ text: "missing mid" }))).toThrow();
  });
  it("rejects mismatched recipient and entry identities", () => {
    const payload = inbound({ mid: "m1", text: "Olá" });
    payload.entry[0]!.messaging[0]!.recipient.id = "another-account";
    expect(() => parseInstagramEvents(payload)).toThrow();
  });
});

describe("Instagram Send API", () => {
  function provider(fetcher: typeof fetch) {
    return new InstagramProvider({ accountId: "178414000000001", accessToken: "secret-token", apiVersion: "v26.0", fetch: fetcher, now });
  }
  it("sends Direct with a scoped user ID and bearer token", async () => {
    const sent: { url: string; body: unknown; authorization: string | null }[] = [];
    const p = provider(async (input, init) => { sent.push({ url: String(input), body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("authorization") }); return Response.json({ recipient_id: "9001", message_id: "out1" }); });
    expect(await p.sendMessage({ externalId: "9001" }, { text: "Olá" })).toEqual({ externalId: "out1" });
    expect(sent).toEqual([{ url: "https://graph.instagram.com/v26.0/178414000000001/messages", body: { recipient: { id: "9001" }, message: { text: "Olá" } }, authorization: "Bearer secret-token" }]);
  });
  it("uses comment_id for a private reply and returns the resolved recipient", async () => {
    let body: unknown;
    const p = provider(async (_input, init) => { body = JSON.parse(String(init?.body)); return Response.json({ recipient_id: "9001", message_id: "out2" }); });
    expect(await p.sendPrivateReply("c1", "Seu guia")).toEqual({ externalId: "out2", recipientId: "9001" });
    expect(body).toEqual({ recipient: { comment_id: "c1" }, message: { text: "Seu guia" } });
  });
  it("sends a private reply template unchanged to comment_id", async () => {
    let body: unknown;
    const p = provider(async (_input, init) => { body = JSON.parse(String(init?.body)); return Response.json({ recipient_id: "9001", message_id: "out2" }); });
    const message = { attachment: { type: "template", payload: { template_type: "button", text: "Quer seu guia?", buttons: [{ type: "postback", title: "Quero", payload: "signed-a1" }] } } };
    expect(await p.sendPrivateReply("c1", "Fallback", message)).toEqual({ externalId: "out2", recipientId: "9001" });
    expect(body).toEqual({ recipient: { comment_id: "c1" }, message });
  });
  it("validates private reply body text and UTF-8 limit before sending", async () => {
    let calls = 0;
    const p = provider(async () => { calls++; return Response.json({ recipient_id: "9001", message_id: "out2" }); });
    for (const message of [{ text: "á".repeat(501) }, { attachment: { payload: { text: "á".repeat(501) } } }, { quick_replies: [] }]) {
      await expect(p.sendPrivateReply("c1", "Curto", message)).rejects.toMatchObject({ code: "invalid_content", certainty: "rejected" });
    }
    expect(calls).toBe(0);
    await expect(p.sendPrivateReply("c1", "á".repeat(501), { text: "á".repeat(500) })).resolves.toEqual({ externalId: "out2", recipientId: "9001" });
  });
  it("enforces 1000 UTF-8 bytes rather than 1000 characters before making a request", async () => {
    let calls = 0;
    const p = provider(async () => { calls++; return Response.json({ message_id: "out1" }); });
    await expect(p.sendMessage({ externalId: "9001" }, { text: "á".repeat(501) })).rejects.toMatchObject({ code: "invalid_content", certainty: "rejected" });
    expect(calls).toBe(0);
  });
  it("accepts the exact UTF-8 limit", async () => {
    const p = provider(async () => Response.json({ message_id: "out1" }));
    await expect(p.sendMessage({ externalId: "9001" }, { text: "á".repeat(500) })).resolves.toEqual({ externalId: "out1" });
  });
  it("never includes tokens or raw Meta messages in errors", async () => {
    const p = provider(async () => Response.json({ error: { code: 190, message: "secret-token bad" } }, { status: 401 }));
    await expect(p.sendMessage({ externalId: "9001" }, { text: "Olá" })).rejects.toMatchObject({ code: "invalid_token", certainty: "rejected" });
    try { await p.sendMessage({ externalId: "9001" }, { text: "Olá" }); } catch (error) { expect(JSON.stringify(error)).not.toContain("secret-token"); expect(String(error)).not.toContain("secret-token"); }
  });
  it("classifies network failures as uncertain to prevent blind resend", async () => {
    const p = provider(async () => { throw new Error("network failed"); });
    await expect(p.sendMessage({ externalId: "9001" }, { text: "Olá" })).rejects.toMatchObject({ certainty: "uncertain" });
  });
  it("classifies malformed success as uncertain because Meta may have accepted", async () => {
    const p = provider(async () => Response.json({ ok: true }));
    await expect(p.sendMessage({ externalId: "9001" }, { text: "Olá" })).rejects.toMatchObject({ certainty: "uncertain" });
  });
  it("rejects endpoint injection through an account or version", () => {
    expect(() => new InstagramProvider({ accountId: "../other", accessToken: "token", apiVersion: "v26.0", fetch, now })).toThrow();
    expect(() => new InstagramProvider({ accountId: "123", accessToken: "token", apiVersion: "v26.0/other", fetch, now })).toThrow();
  });
  it("reads a profile without putting the token in the URL", async () => {
    let url = "";
    const p = provider(async (input) => { url = String(input); return Response.json({ name: "Cliente", username: "cliente" }); });
    expect(await p.getContact("9001")).toEqual({ name: "Cliente" });
    expect(url).toBe("https://graph.instagram.com/v26.0/9001?fields=name%2Cusername");
  });
});

describe("Instagram buttons and quick replies", () => {
  const postback = (extra: Record<string, unknown> = {}, sender = "9001") => ({ object: "instagram", entry: [{ id: "178414000000001", time: 1791806400, messaging: [{ sender: { id: sender }, recipient: { id: sender === "9001" ? "178414000000001" : "9001" }, timestamp: 1791806400000, postback: { mid: "pb1", title: "Quero", payload: "signed.payload", ...extra } }] }] });
  it("parses a quick reply as a message keeping its text and payload", () => {
    expect(parseInstagramEvents(inbound({ mid: "m9", text: "Sim", quick_reply: { payload: "signed.q" } }))).toEqual([{ kind: "message", accountId: "178414000000001", externalId: "m9", senderExternalId: "9001", senderName: null, text: "Sim", occurredAt: "2026-10-12T12:00:00.000Z", context: { origin: "quick_reply", payload: "signed.q" } }]);
  });
  it("parses a postback as a button event", () => {
    expect(parseInstagramEvents(postback())).toEqual([{ kind: "button", accountId: "178414000000001", externalId: "pb1", senderExternalId: "9001", title: "Quero", payload: "signed.payload", occurredAt: "2026-10-12T12:00:00.000Z" }]);
  });
  it("derives an external id when the postback has no mid", () => {
    expect(parseInstagramEvents(postback({ mid: undefined }))[0]).toMatchObject({ kind: "button", externalId: "postback:1791806400000:9001" });
  });
  it("ignores flagged echo postbacks", () => {
    expect(parseInstagramEvents(postback({ is_echo: true }, "178414000000001"))[0]).toMatchObject({ kind: "ignored", reason: "echo" });
    expect(parseInstagramEvents(postback({ is_echo: true }))[0]).toMatchObject({ kind: "ignored" });
  });
  it("rejects a postback without payload", () => {
    expect(() => parseInstagramEvents(postback({ payload: "" }))).toThrow();
  });
  it("sends the instagram body verbatim", async () => {
    let body: unknown;
    const p = new InstagramProvider({ accountId: "178414000000001", accessToken: "t", apiVersion: "v26.0", fetch: async (_i, init) => { body = JSON.parse(String(init?.body)); return Response.json({ message_id: "out9" }); }, now });
    const message = { text: "Quer?", quick_replies: [{ content_type: "text", title: "Sim", payload: "p" }] };
    await p.sendMessage({ externalId: "9001" }, { text: "Quer?", instagram: message });
    expect(body).toEqual({ recipient: { id: "9001" }, message });
  });
});

describe("Instagram buttons: validation", () => {
  const withMessaging = (m: Record<string, unknown>) => ({ object: "instagram", entry: [{ id: "178414000000001", time: 1791806400, messaging: [{ timestamp: 1791806400000, ...m }] }] });
  const prov = (fetcher: typeof fetch) => new InstagramProvider({ accountId: "178414000000001", accessToken: "t", apiVersion: "v26.0", fetch: fetcher, now });
  it("throws for a postback to a different recipient", () => {
    expect(() => parseInstagramEvents(withMessaging({ sender: { id: "9001" }, recipient: { id: "other" }, postback: { mid: "p", title: "Q", payload: "x" } }))).toThrow("Invalid Instagram postback recipient");
  });
  it("throws for a non-echo postback sent by the account itself", () => {
    expect(() => parseInstagramEvents(withMessaging({ sender: { id: "178414000000001" }, recipient: { id: "9001" }, postback: { mid: "p", title: "Q", payload: "x" } }))).toThrow();
  });
  it("throws for a quick reply to a wrong recipient", () => {
    expect(() => parseInstagramEvents(withMessaging({ sender: { id: "9001" }, recipient: { id: "other" }, message: { mid: "m", text: "Sim", quick_reply: { payload: "p" } } }))).toThrow("Invalid Instagram message recipient");
  });
  it("uses a fallback text for a quick reply without text", () => {
    expect(parseInstagramEvents(inbound({ mid: "m", quick_reply: { payload: "p" } }))[0]).toMatchObject({ kind: "message", text: "[Resposta rápida]", context: { origin: "quick_reply" } });
  });
  it("validates the text inside the instagram body, not content.text", async () => {
    let calls = 0;
    const p = prov(async () => { calls++; return Response.json({ message_id: "o" }); });
    await expect(p.sendMessage({ externalId: "9001" }, { text: "curto", instagram: { text: "á".repeat(501) } })).rejects.toMatchObject({ code: "invalid_content" });
    await expect(p.sendMessage({ externalId: "9001" }, { text: "curto", instagram: { attachment: { type: "template", payload: { template_type: "button", text: "á".repeat(501), buttons: [] } } } })).rejects.toMatchObject({ code: "invalid_content" });
    await expect(p.sendMessage({ externalId: "9001" }, { text: "curto", instagram: { quick_replies: [] } })).rejects.toMatchObject({ code: "invalid_content" });
    expect(calls).toBe(0);
    await expect(p.sendMessage({ externalId: "9001" }, { text: "á".repeat(501), instagram: { text: "ok" } })).resolves.toEqual({ externalId: "o" });
  });
});

describe("Instagram referral (7B)", () => {
  const A = "178414000000001";
  const standalone = (referral: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ object: "instagram", entry: [{ id: A, time: 1791806400, messaging: [{ sender: { id: "9001" }, recipient: { id: A }, timestamp: 1791806400000, referral, ...extra }] }] });
  it("parses a standalone referral", () => {
    expect(parseInstagramEvents(standalone({ ref: "promo1", source: "SHORTLINK", type: "OPEN_THREAD" }))).toEqual([{ kind: "referral", accountId: A, externalId: "referral:1791806400000:9001", senderExternalId: "9001", ref: "promo1", source: "SHORTLINK", occurredAt: "2026-10-12T12:00:00.000Z" }]);
  });
  it("uses null source when absent", () => {
    expect(parseInstagramEvents(standalone({ ref: "promo1" }))[0]).toMatchObject({ kind: "referral", source: null });
  });
  it("ignores a referral without ref", () => {
    expect(parseInstagramEvents(standalone({ ref: "" }))[0]).toMatchObject({ kind: "ignored", reason: "referral_without_ref" });
    expect(parseInstagramEvents(standalone({}))[0]).toMatchObject({ kind: "ignored", reason: "referral_without_ref" });
  });
  it("throws for a referral to the wrong recipient", () => {
    const p = standalone({ ref: "x" });
    p.entry[0]!.messaging[0]!.recipient.id = "other";
    expect(() => parseInstagramEvents(p)).toThrow("Invalid Instagram referral recipient");
  });
  it("throws when the account is the sender", () => {
    const p = standalone({ ref: "x" });
    p.entry[0]!.messaging[0]!.sender.id = A;
    expect(() => parseInstagramEvents(p)).toThrow("Invalid Instagram referral recipient");
  });
  it("adds context.referral to a message carrying a referral", () => {
    expect(parseInstagramEvents(inbound({ mid: "m1", text: "Oi", referral: { ref: "promo1", source: "SHORTLINK" } }))[0]).toMatchObject({ kind: "message", text: "Oi", context: { origin: "direct", referral: { ref: "promo1" } } });
  });
  it("keeps the origin for a quick reply with referral", () => {
    expect(parseInstagramEvents(inbound({ mid: "m1", text: "Sim", quick_reply: { payload: "p" }, referral: { ref: "r" } }))[0]).toMatchObject({ context: { origin: "quick_reply", payload: "p", referral: { ref: "r" } } });
  });
  it("omits context.referral when the message referral has no ref", () => {
    const e = parseInstagramEvents(inbound({ mid: "m1", text: "Oi", referral: { ref: "" } }))[0] as { context: Record<string, unknown> };
    expect(e.context).toEqual({ origin: "direct" });
  });
  it("ignores echoes carrying a referral", () => {
    expect(parseInstagramEvents(inbound({ mid: "m1", text: "Oi", is_echo: true, referral: { ref: "r" } }))[0]).toMatchObject({ kind: "ignored" });
  });
});
