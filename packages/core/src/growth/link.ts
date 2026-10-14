const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function defaultRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0]! / 0x100000000;
}

/** Código de 8 caracteres [a-z0-9]. `random` injetável para testes. */
export function generateLinkCode(random: () => number = defaultRandom): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[Math.min(ALPHABET.length - 1, Math.floor(random() * ALPHABET.length))];
  return out;
}

export function instagramEntryLink(username: string, code: string): string {
  return `https://ig.me/m/${encodeURIComponent(username)}?ref=${encodeURIComponent(code)}`;
}
