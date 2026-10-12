import { expect, test, vi } from "vitest";

const RULE_BUSY = "00000000-0000-4000-8000-0000000000a1";
const RULE_QUIET = "00000000-0000-4000-8000-0000000000a2";
// 150 eventos recentes da regra movimentada e 1 evento antigo da regra quieta.
const events = [
  ...Array.from({ length: 150 }, (_, i) => ({ rule_id: RULE_BUSY, state: "ignored", last_error: null, created_at: `2026-10-12T10:${String(i % 60).padStart(2, "0")}:00Z` })),
  { rule_id: RULE_QUIET, state: "done", last_error: null, created_at: "2026-10-01T10:00:00Z" },
].sort((a, b) => b.created_at.localeCompare(a.created_at));

function table(name: string) {
  const filters = new Map<string, unknown>(); let limit = Infinity;
  const rows = () => {
    if (name === "meta_connections") return [{ id: "c1", app_id: "1", api_version: "v26.0", token_verified_at: null, webhook_verified_at: null, disconnected_at: null, last_error: null }];
    if (name === "channels") return [{ id: "ch1", name: "IG", status: "active", external_account_id: "9", meta_connection_id: "c1" }];
    if (name === "instagram_comment_rules") return [RULE_BUSY, RULE_QUIET].map((id) => ({ id, channel_id: "ch1", keyword: "k", reply_text: "r", media_id: null, active: true }));
    return events.filter((event) => !filters.has("rule_id") || event.rule_id === filters.get("rule_id")).slice(0, limit);
  };
  const q = {
    select: () => q, order: () => q,
    eq: (column: string, value: unknown) => { filters.set(column, value); return q; },
    limit: (n: number) => { limit = n; return q; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: rows(), error: null }),
  };
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ from: (name: string) => table(name) }) }));
import { listInstagramSettings } from "./queries";

test("último resultado vem do evento mais recente de cada regra, não dos 100 mais recentes da organização", async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
  const { rules } = await listInstagramSettings("org");
  expect(rules.find((rule) => rule.id === RULE_BUSY)?.lastState).toBe("ignored");
  expect(rules.find((rule) => rule.id === RULE_QUIET)?.lastState).toBe("done");
});
