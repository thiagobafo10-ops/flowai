export type Resolver = (host: string) => Promise<string[]>;
export type WebhookResult =
  | { ok: true; status: number }
  | { ok: false; code: "invalid_url" | "blocked_address" | "timeout" | "http_error" | "too_large" | "network_error"; retryable: boolean };

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export const defaultResolver: Resolver = async (host) => {
  const [a, aaaa] = await Promise.allSettled([Deno.resolveDns(host, "A"), Deno.resolveDns(host, "AAAA")]);
  const out: string[] = [];
  if (a.status === "fulfilled") out.push(...a.value);
  if (aaaa.status === "fulfilled") out.push(...aaaa.value);
  if (out.length === 0) throw new Error("dns_failed");
  return out;
};

function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

function blockedIPv4(o: number[]): boolean {
  const [a, b] = o;
  return a === 0 || a === 10 || (a === 100 && b >= 64 && b <= 127) || a === 127 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    a >= 224; // 224/4 multicast and 240/4 reserved (includes broadcast)
}

function parseIPv6(input: string): number[] | null {
  let s = input;
  const zone = s.indexOf("%"); if (zone >= 0) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(":");
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) { // embedded IPv4 tail
    const v4 = parseIPv4(tail); if (!v4) return null;
    s = s.slice(0, lastColon + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (p: string) => p === "" ? [] : p.split(":");
  const head = toGroups(halves[0]); const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...(halves.length === 2 ? Array(missing).fill("0") : []), ...rest];
  const nums = all.map((g) => /^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN);
  return nums.length === 8 && nums.every((n) => !Number.isNaN(n)) ? nums : null;
}

/** Fail closed: anything that is not a recognizable public IP is treated as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const host = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  const v4 = parseIPv4(host);
  if (v4) return blockedIPv4(v4);
  const g = parseIPv6(host);
  if (!g) return true;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    // ::, ::1, IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d)
    if (g[5] === 0 && g[6] === 0 && g[7] <= 1) return true;
    return blockedIPv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]);
  }
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80;
}

function isIpLiteral(host: string): boolean {
  return host.startsWith("[") || parseIPv4(host) !== null;
}

function fail(code: Extract<WebhookResult, { ok: false }>["code"], retryable: boolean): WebhookResult {
  return { ok: false, code, retryable };
}

function isTimeout(e: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError"));
}

/**
 * Resolves the host, rejects if ANY address is blocked, then POSTs JSON without following redirects.
 *
 * Residual risk (DNS rebinding): Deno's fetch cannot pin the connection to a vetted IP while keeping
 * SNI/Host for HTTPS, so the hostname is resolved a second time by fetch itself. We narrow the window
 * by fetching immediately after the check and by refusing redirects, but a hostile DNS server that
 * answers differently between the two lookups could still reach an internal address.
 * Never log the URL (query may hold secrets) or the body.
 */
export async function postSafeWebhook(
  url: string,
  body: unknown,
  deps: { fetch: typeof fetch; resolve?: Resolver; timeoutMs?: number },
): Promise<WebhookResult> {
  let u: URL;
  try { u = new URL(url); } catch { return fail("invalid_url", false); }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return fail("invalid_url", false);

  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return fail("blocked_address", false);
  if (isIpLiteral(host)) {
    if (isBlockedAddress(host)) return fail("blocked_address", false);
  } else {
    let addrs: string[];
    try { addrs = await (deps.resolve ?? defaultResolver)(host); } catch { return fail("network_error", true); }
    if (addrs.length === 0 || addrs.some(isBlockedAddress)) return fail("blocked_address", false);
  }

  const signal = AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await deps.fetch(u.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "FlowAI-Webhook/1" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal,
    });
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel().catch(() => {});
      if (res.status >= 300 && res.status < 400) return fail("http_error", false);
      return fail("http_error", res.status >= 500 || res.status === 429 || res.status === 408);
    }
    if (res.body) {
      const reader = res.body.getReader(); let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => {}); return fail("too_large", false); }
      }
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return isTimeout(e, signal) ? fail("timeout", true) : fail("network_error", true);
  }
}
