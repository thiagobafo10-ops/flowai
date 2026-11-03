import { handleEmailWorker, type ClaimedSend } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const appUrl = Deno.env.get("FLOWAI_APP_URL")!.replace(/\/+$/, "");

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(30000),
  });
  // Never propagate the response body: it may echo keys or addresses.
  if (!response.ok) { await response.body?.cancel(); throw new Error("Database operation failed"); }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

Deno.serve((request) => handleEmailWorker(request, {
  readWorkerSecret: async () => (await rpc<{ workerSecret: string } | null>("read_automation_worker_config", {}))?.workerSecret ?? null,
  claim: async (limit) => (await rpc<ClaimedSend[] | null>("claim_email_sends", { p_limit: limit })) ?? [],
  complete: (sendId, result, providerId, error) => rpc<void>("complete_email_send", { p_send: sendId, p_result: result, p_provider_id: providerId, p_error: error }),
  fetch, appUrl,
}));
