import { expect, test } from "vitest";
import { readTextFile } from "./file";

const file = (parts: BlobPart[], name: string) => new File(parts, name);

test("rejeita extensão diferente de .txt/.md", async () => {
  expect(await readTextFile(file(["oi"], "a.pdf"))).toEqual({ ok: false, error: "Envie um arquivo .txt ou .md." });
});
test("rejeita arquivo acima de 1 MB", async () => {
  const big = file([new Uint8Array(1048577)], "a.txt");
  expect(await readTextFile(big)).toEqual({ ok: false, error: "O arquivo deve ter até 1 MB." });
});
test("rejeita arquivo que não é UTF-8", async () => {
  expect(await readTextFile(file([new Uint8Array([0xff, 0xfe, 0xfd])], "a.md"))).toEqual({ ok: false, error: "O arquivo precisa estar em texto UTF-8." });
});
test("lê .txt e .md sem diferenciar maiúsculas", async () => {
  expect(await readTextFile(file(["olá"], "FAQ.TXT"))).toEqual({ ok: true, text: "olá" });
  expect(await readTextFile(file(["# t"], "x.Md"))).toEqual({ ok: true, text: "# t" });
});
test("aceita exatamente 1 MB", async () => {
  const r = await readTextFile(file([new Uint8Array(1048576).fill(97)], "a.txt"));
  expect(r.ok).toBe(true);
});
