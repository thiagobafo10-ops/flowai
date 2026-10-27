import { handleMetaTokenRefresh, type TokenCandidate } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(30000),
  });
  // Never propagate the response body: it may echo the arguments (tokens).
  if (!response.ok) { await response.body?.cancel(); throw new Error("Database operation failed"); }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

Deno.serve((request) => handleMetaTokenRefresh(request, {
  readWorkerSecret: async () => (await rpc<{ workerSecret: string } | null>("read_automation_worker_config", {}))?.workerSecret ?? null,
  candidates: async () => (await rpc<TokenCandidate[] | null>("meta_token_refresh_candidates", {})) ?? [],
  record: (channelId, generation, token, expiresIn, error) => rpc<void>("record_meta_token_refresh", {
    p_channel: channelId, p_generation: generation, p_token: token, p_expires_in: expiresIn, p_error: error,
  }),
  fetch, now: () => new Date(),
}));
