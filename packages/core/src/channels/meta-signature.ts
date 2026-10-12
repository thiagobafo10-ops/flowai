/** Verify the bytes exactly as received, before decoding or parsing JSON. */
export async function verifyMetaSignature(body: Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature) || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const hex = signature.slice(7);
  const expected = Uint8Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  return crypto.subtle.verify("HMAC", key, expected, Uint8Array.from(body));
}
