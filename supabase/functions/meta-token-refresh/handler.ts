import { constantTimeTextEqual } from "../_shared/http.ts";

export type TokenCandidate = { channelId: string; generation: number; accessToken: string; apiVersion: string };
export type RefreshError = "token_refresh_failed" | "invalid_token";
export type MetaTokenRefreshDeps = {
  readWorkerSecret(): Promise<string | null>;
  candidates(): Promise<TokenCandidate[]>;
  record(channelId: string, generation: number, token: string | null, expiresIn: number | null, error: RefreshError | null): Promise<void>;
  fetch: typeof fetch;
  now(): Date;
  sleep?: (ms: number) => Promise<void>;
  /** Receives fixed event names, channel ids and error codes only — never a token, URL or Meta response text. */
  log?: (...args: string[]) => void;
  budgetMs?: number;
};

const REFRESH_URL = "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token";
const BUDGET_MS = 90_000;
// A token Meta already renewed is only kept if it is recorded: retry transient database failures.
const RECORD_BACKOFF_MS = [1_000, 3_000];

function log(deps: MetaTokenRefreshDeps, event: string, fields: Record<string, string | null>): void {
  (deps.log ?? console.error)("meta-token-refresh", event, JSON.stringify(fields));
}

type RefreshResult = { token: string; expiresIn: number } | { error: RefreshError };

async function refresh(candidate: TokenCandidate, deps: MetaTokenRefreshDeps): Promise<RefreshResult> {
  try {
    // Documented contract: the token goes in the access_token query parameter. The URL (and any
    // fetch error, which may quote it) is never logged or returned — only fixed codes leave here.
    const response = await deps.fetch(`${REFRESH_URL}&access_token=${encodeURIComponent(candidate.accessToken)}`, {
      method: "GET", signal: AbortSignal.timeout(15000),
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { /* malformed reply: generic failure */ }
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    if (!response.ok) {
      const error = data.error as Record<string, unknown> | undefined;
      return { error: error && Number(error.code) === 190 ? "invalid_token" : "token_refresh_failed" };
    }
    const token = data.access_token, expiresIn = data.expires_in;
    if (typeof token !== "string" || token.length < 1 || token.length > 8192
      || typeof expiresIn !== "number" || !Number.isInteger(expiresIn) || expiresIn <= 0 || expiresIn > 2_147_483_647) {
      return { error: "token_refresh_failed" };
    }
    return { token, expiresIn };
  } catch { return { error: "token_refresh_failed" }; }
}

async function recordWithRetry(candidate: TokenCandidate, result: RefreshResult, deps: MetaTokenRefreshDeps, deadline: number): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retries = "token" in result ? RECORD_BACKOFF_MS : [];
  for (let attempt = 0; ; attempt++) {
    try {
      if ("token" in result) await deps.record(candidate.channelId, candidate.generation, result.token, result.expiresIn, null);
      else await deps.record(candidate.channelId, candidate.generation, null, null, result.error);
      return true;
    } catch {
      const wait = retries[attempt];
      if (wait === undefined || deps.now().getTime() + wait >= deadline) return false;
      log(deps, "record_retry", { channelId: candidate.channelId });
      await sleep(wait);
    }
  }
}

export async function handleMetaTokenRefresh(request: Request, deps: MetaTokenRefreshDeps): Promise<Response> {
  const deadline = deps.now().getTime() + (deps.budgetMs ?? BUDGET_MS);
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  try {
    const secret = await deps.readWorkerSecret();
    const provided = request.headers.get("x-flowai-worker") ?? "";
    if (!secret || !provided || provided.length > 8192 || !await constantTimeTextEqual(provided, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
    let refreshed = 0, failed = 0;
    // Sequential: a handful of channels per day; the remaining ones are retried by the next run.
    for (const candidate of await deps.candidates()) {
      if (deps.now().getTime() >= deadline) { log(deps, "budget_exhausted", {}); break; }
      const result = await refresh(candidate, deps);
      // A renewed token is always recorded (it would otherwise be lost); a failure code is only
      // recorded while there is time left — the next run retries that channel anyway.
      if (!("token" in result) && deps.now().getTime() >= deadline) { log(deps, "budget_exhausted", {}); break; }
      if (!await recordWithRetry(candidate, result, deps, deadline)) {
        failed++; log(deps, "record_failed", { channelId: candidate.channelId });
      } else if ("token" in result) {
        refreshed++; log(deps, "refreshed", { channelId: candidate.channelId });
      } else {
        failed++; log(deps, "refresh_failed", { channelId: candidate.channelId, code: result.error });
      }
    }
    return Response.json({ refreshed, failed });
  } catch { return Response.json({ error: "temporarily_unavailable" }, { status: 503 }); }
}
