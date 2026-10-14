export type Resolver = (host: string) => Promise<string[]>;
export type WebhookResult =
  | { ok: true; status: number }
  | { ok: false; code: "invalid_url" | "blocked_address" | "timeout" | "http_error" | "too_large" | "network_error" | "invalid_body"; retryable: boolean };

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export const defaultResolver: Resolver = async (host) => {
  const [a, aaaa] = await Promise.allSettled([Deno.resolveDns(host, "A"), Deno.resolveDns(host, "AAAA")]);
  const out: string[] = [];
  for (const r of [a, aaaa]) {
    if (r.status === "fulfilled") out.push(...r.value);
    // Only NXDOMAIN/NODATA (NotFound) may be ignored; any other failure of one family fails closed.
    else if (!(r.reason instanceof Deno.errors.NotFound)) throw new Error("dns_failed");
  }
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
    (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && (o[2] === 0 || o[2] === 2)) ||
    (a === 198 && b === 51 && o[2] === 100) || (a === 203 && b === 0 && o[2] === 113) ||
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
  const v4of = (hi: number, lo: number) => blockedIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  // NAT64 64:ff9b::/96 checks the embedded IPv4; 64:ff9b:1::/48 and anything else under 64:ff9b is blocked.
  if (g[0] === 0x64 && g[1] === 0xff9b) return zeros(2, 6) ? v4of(g[6], g[7]) : true;
  if (zeros(0, 4) && g[4] === 0xffff && g[5] === 0) return v4of(g[6], g[7]); // SIIT ::ffff:0:0:0/96
  if (g[0] === 0x2002) return v4of(g[1], g[2]); // 6to4
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
  if (g[0] === 0x100 && zeros(1, 4)) return true; // discard 100::/64
  if ((g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00) return true; // site-local, multicast
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
  deps: { fetch: typeof fetch; resolve?: Resolver; timeoutMs?: number; headers?: Record<string, string> },
): Promise<WebhookResult> {
  let u: URL;
  try { u = new URL(url); } catch { return fail("invalid_url", false); }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return fail("invalid_url", false);

  let payload: string | undefined;
  try { payload = JSON.stringify(body); } catch { payload = undefined; }
  if (payload === undefined) return fail("invalid_body", false);

  const signal = AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const host = u.hostname.toLowerCase().replace(/\.+$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return fail("blocked_address", false);
  if (isIpLiteral(host)) {
    if (isBlockedAddress(host)) return fail("blocked_address", false);
  } else {
    let addrs: string[];
    try {
      addrs = await Promise.race([
        (deps.resolve ?? defaultResolver)(host),
        new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(signal.reason), { once: true })),
      ]);
    } catch (e) { return isTimeout(e, signal) ? fail("timeout", true) : fail("network_error", true); }
    if (addrs.length === 0 || addrs.some(isBlockedAddress)) return fail("blocked_address", false);
  }

  try {
    const res = await deps.fetch(u.toString(), {
      method: "POST",
      headers: { ...deps.headers, "content-type": "application/json", "user-agent": "FlowAI-Webhook/1" },
      body: payload,
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
