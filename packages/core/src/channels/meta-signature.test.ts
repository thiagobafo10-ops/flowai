import { expect, it } from "vitest";
import { verifyMetaSignature } from "./index.ts";

it("validates a known HMAC SHA256 vector", async () => {
  const bytes = new TextEncoder().encode("The quick brown fox jumps over the lazy dog");
  const signature = "sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
  expect(await verifyMetaSignature(bytes, signature, "key")).toBe(true);
  expect(await verifyMetaSignature(new TextEncoder().encode("The quick brown fox jumps over the lazy dog "), signature, "key")).toBe(false);
  expect(await verifyMetaSignature(bytes, signature, "wrong")).toBe(false);
});
it.each([null, "", "sha1=abc", "sha256=abc", "sha256=" + "z".repeat(64)])("rejects malformed signature %s", async (signature) => {
  expect(await verifyMetaSignature(new Uint8Array(), signature, "key")).toBe(false);
});
