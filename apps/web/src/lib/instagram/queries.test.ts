import { expect, test, vi } from "vitest";

const touched: string[] = [];
function table(name: string) {
  touched.push(name);
  const rows = () => {
    if (name === "meta_connections") return [{ id: "c1", app_id: "1", api_version: "v26.0", token_verified_at: null, webhook_verified_at: null, disconnected_at: null, last_error: null }];
    if (name === "channels") return [{ id: "ch1", name: "IG", status: "active", external_account_id: "9", meta_connection_id: "c1" }];
    return [];
  };
  const q = {
    select: () => q, order: () => q, eq: () => q, limit: () => q,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows(), error: null }),
  };
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ from: (name: string) => table(name) }) }));
import { listInstagramSettings } from "./queries";

test("lists connections with their channel and no longer loads legacy comment rules or their events", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321/";
  const settings = await listInstagramSettings("org");
  expect(settings).toEqual({
    connections: [{
      id: "c1", channelId: "ch1", name: "IG", status: "active", accountId: "9", appId: "1", apiVersion: "v26.0", tokenVerified: false,
      webhookVerified: false, disconnected: false, lastError: null, callbackUrl: "http://127.0.0.1:54321/functions/v1/meta-webhook/c1", vip: undefined,
    }],
  });
  expect(touched.sort()).toEqual(["channels", "instagram_vip_settings", "meta_connections"]);
});
