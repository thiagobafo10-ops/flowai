import { afterEach, expect, test, vi } from "vitest";
import { copyEntryLink, downloadEntryLinkQr } from "./export";
afterEach(() => vi.unstubAllGlobals());
test("falha do clipboard é propagada para o feedback da interface", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: async () => { throw new Error("denied"); } } });
  await expect(copyEntryLink("https://ig.me/m/loja?ref=promo")).rejects.toThrow("denied");
});
test.each(["png", "svg"] as const)("download %s tem formato e nome corretos e libera o objeto", async (format) => {
  const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  let blob: Blob | undefined;
  vi.stubGlobal("document", { createElement: () => anchor, body: { appendChild: vi.fn() } });
  vi.stubGlobal("URL", { createObjectURL(value: Blob) { blob = value; return "blob:qr"; }, revokeObjectURL: vi.fn() });
  await downloadEntryLinkQr("https://ig.me/m/loja?ref=promo", "promo", format);
  expect(anchor.download).toBe(`promo.${format}`);
  expect(anchor.href).toBe("blob:qr");
  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.remove).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:qr");
  expect(blob?.type).toBe(format === "png" ? "image/png" : "image/svg+xml");
  if (format === "svg") expect(await blob!.text()).toContain("<svg");
  else expect(Array.from(new Uint8Array(await blob!.arrayBuffer()).slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});
