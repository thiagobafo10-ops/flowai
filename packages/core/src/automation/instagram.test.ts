import { describe, expect, it } from "vitest";
import { toInstagramMessage } from "./instagram.ts";

describe("toInstagramMessage", () => {
  it("returns plain text when there are no options", () => {
    expect(toInstagramMessage("Oi", { payloads: {} })).toEqual({ text: "Oi" });
  });

  it("builds quick replies with signed payloads", () => {
    expect(
      toInstagramMessage("Quer?", { quickReplies: [{ id: "sim", title: "Sim" }, { id: "nao", title: "Não" }], payloads: { sim: "p1", nao: "p2" } }),
    ).toEqual({
      text: "Quer?",
      quick_replies: [
        { content_type: "text", title: "Sim", payload: "p1" },
        { content_type: "text", title: "Não", payload: "p2" },
      ],
    });
  });

  it("builds a button template with postback and web_url buttons", () => {
    expect(
      toInstagramMessage("Escolha", {
        buttons: [
          { id: "a", title: "Quero", kind: "path" },
          { id: "b", title: "Site", kind: "url", url: "https://exemplo.com.br" },
        ],
        payloads: { a: "pa" },
      }),
    ).toEqual({
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Escolha",
          buttons: [
            { type: "postback", title: "Quero", payload: "pa" },
            { type: "web_url", url: "https://exemplo.com.br", title: "Site" },
          ],
        },
      },
    });
  });
});

describe("toInstagramMessage limits", () => {
  const ok = { payloads: { a: "pa", b: "pb" } };
  const qr = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i}`, title: "T" }));
  const payloads = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`q${i}`, "p"]));
  it("rejects blank text and text over 1000 UTF-8 bytes, accepting exactly 1000", () => {
    expect(() => toInstagramMessage("   ", ok)).toThrow("invalid_content");
    expect(() => toInstagramMessage("á".repeat(501), ok)).toThrow("invalid_content");
    expect(toInstagramMessage("á".repeat(500), ok)).toEqual({ text: "á".repeat(500) });
  });
  it("limits buttons to 3 and quick replies to 13", () => {
    const b = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i}`, title: "T", kind: "path" as const }));
    expect(() => toInstagramMessage("x", { buttons: b(4), payloads: payloads(4) })).toThrow("invalid_content");
    expect(() => toInstagramMessage("x", { buttons: b(3), payloads: payloads(3) })).not.toThrow();
    expect(() => toInstagramMessage("x", { quickReplies: qr(14), payloads: payloads(14) })).toThrow("invalid_content");
    expect(() => toInstagramMessage("x", { quickReplies: qr(13), payloads: payloads(13) })).not.toThrow();
  });
  it("validates titles from 1 to 20 characters", () => {
    expect(() => toInstagramMessage("x", { quickReplies: [{ id: "a", title: "" }], payloads: { a: "p" } })).toThrow("invalid_content");
    expect(() => toInstagramMessage("x", { quickReplies: [{ id: "a", title: "x".repeat(21) }], payloads: { a: "p" } })).toThrow("invalid_content");
    expect(() => toInstagramMessage("x", { buttons: [{ id: "a", title: "x".repeat(21), kind: "path" }], payloads: { a: "p" } })).toThrow("invalid_content");
    expect(() => toInstagramMessage("x", { quickReplies: [{ id: "a", title: "x".repeat(20) }], payloads: { a: "p" } })).not.toThrow();
  });
  it("rejects buttons together with quick replies", () => {
    expect(() => toInstagramMessage("x", { buttons: [{ id: "a", title: "A", kind: "path" }], quickReplies: [{ id: "b", title: "B" }], payloads: ok.payloads })).toThrow("invalid_content");
  });
  it("requires non-empty payloads for path buttons and quick replies", () => {
    expect(() => toInstagramMessage("x", { buttons: [{ id: "a", title: "A", kind: "path" }], payloads: { a: "" } })).toThrow("invalid_content");
    expect(() => toInstagramMessage("x", { quickReplies: [{ id: "a", title: "A" }], payloads: {} })).toThrow("invalid_content");
  });
  it("requires an https url for url buttons", () => {
    for (const url of [undefined, "http://x.com", "javascript:alert(1)", "nope"]) {
      expect(() => toInstagramMessage("x", { buttons: [{ id: "a", title: "A", kind: "url", ...(url ? { url } : {}) }], payloads: {} })).toThrow("invalid_content");
    }
  });
  it("never includes the text in the error", () => {
    expect(() => toInstagramMessage("segredo", { quickReplies: [{ id: "x", title: "" }], payloads: { x: "p" } })).toThrow(/^(?!.*segredo)/s);
    let message = "";
    try { toInstagramMessage("segredo", { quickReplies: [{ id: "x", title: "X" }], payloads: {} }); } catch (e) { message = String(e); }
    expect(message).toContain("invalid_content");
    expect(message).not.toContain("segredo");
  });
});
