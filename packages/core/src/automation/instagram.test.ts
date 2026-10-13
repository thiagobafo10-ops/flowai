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

  it("throws without leaking text when a payload is missing", () => {
    expect(() => toInstagramMessage("segredo", { quickReplies: [{ id: "x", title: "X" }], payloads: {} })).toThrow(/payload/);
    try {
      toInstagramMessage("segredo", { buttons: [{ id: "x", title: "X", kind: "path" }], payloads: {} });
    } catch (e) {
      expect(String(e)).not.toContain("segredo");
    }
  });
});
