export class BodyTooLarge extends Error {}
export async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) throw new BodyTooLarge();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Body read timeout")), 10000); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.length;
      if (size > limit) throw new BodyTooLarge();
      chunks.push(value);
    }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    return body;
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { clearTimeout(timer!); reader.releaseLock(); }
}
export async function constantTimeTextEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const first = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(a)));
  const second = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(b)));
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= first[i] ^ second[i];
  return difference === 0;
}
