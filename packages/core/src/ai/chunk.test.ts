import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk.ts";

describe("chunkText", () => {
  it("returns [] for empty text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("  \n\n ")).toEqual([]);
  });

  it("keeps short paragraphs in a single chunk", () => {
    const text = "Primeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro parágrafo.";
    const chunks = chunkText(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.index).toBe(0);
    expect(chunks[0]!.content).toContain("Primeiro");
    expect(chunks[0]!.content).toContain("Segundo");
    expect(chunks[0]!.content).toContain("Terceiro");
    expect(chunks[0]!.tokenCount).toBe(Math.ceil(chunks[0]!.content.length / 4));
  });

  it("splits long text with sequential indexes and overlap", () => {
    const paragraphs = Array.from({ length: 10 }, (_, p) =>
      Array.from({ length: 125 }, (_, w) => `p${p}w${w}`.padEnd(7, "x")).join(" ").slice(0, 1000),
    );
    const chunks = chunkText(paragraphs.join("\n\n"));
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.content.length).toBeLessThanOrEqual(3200);
      expect(c.content.trim()).not.toBe("");
      expect(c.tokenCount).toBe(Math.ceil(c.content.length / 4));
    });
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1]!.content;
      expect(prev.slice(-420).includes(chunks[i]!.content.slice(0, 50))).toBe(true);
    }
  });

  it("hard-cuts a single 10000-char paragraph without spaces and covers all text", () => {
    const text = "a".repeat(10000);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(3200);
    expect(chunks[0]!.content.startsWith("a")).toBe(true);
    const total = chunks.reduce((n, c, i) => n + c.content.length - (i > 0 ? 400 : 0), 0);
    expect(total).toBeGreaterThanOrEqual(10000);
  });

  it("splits oversized paragraphs by sentences", () => {
    const sentence = "Esta é uma frase de teste razoavelmente longa para o chunking. ";
    const chunks = chunkText(sentence.repeat(200));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(3200);
  });
});
