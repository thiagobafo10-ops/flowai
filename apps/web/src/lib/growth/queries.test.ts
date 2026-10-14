import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, calls: [] as { table: string; columns: string; options?: unknown; filters: unknown[][] }[], error: null as null | { code: string } }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ from(table: string) {
  const call = { table, columns: "", options: undefined as unknown, filters: [] as unknown[][] };
  state.calls.push(call);
  const q = {
    select(columns: string, options?: unknown) { call.columns = columns; call.options = options; return q; },
    eq(column: string, value: unknown) { call.filters.push([column, value]); return q; },
    gte(column: string, value: unknown) { call.filters.push([column, value]); return q; },
    in: () => q, order: () => q,
    then(resolve: (v: unknown) => unknown) { return resolve({ data: state.tables[table] ?? [], error: state.error, count: call.filters.some(([key]) => key === "created_at") ? 3 : 1501 }); },
  }; return q;
} }) }));
import { listEntryLinks } from "./queries";
beforeEach(() => { state.calls = []; state.tables = {}; state.error = null; });

test("liga automação pelo gatilho e contabiliza usos exatos além do limite de linhas", async () => {
  state.tables = {
    channels: [{ id: "ch", name: "Loja", type: "instagram", status: "active", instagram_username: "loja.x" }],
    tags: [{ id: "tag", name: "Lead" }],
    entry_links: [{ id: "link", name: "Promoção", channel_id: "ch", code: "promo", tag_id: "tag", status: "active" }],
    automations: [{ id: "auto", name: "Boas-vindas", trigger_config: { linkIds: ["link"] }, status: "active" }],
  };
  const result = await listEntryLinks("org", new Date("2026-10-14T12:00:00Z"));
  expect(result.links[0]).toMatchObject({ id: "link", url: "https://ig.me/m/loja.x?ref=promo", usesTotal: 1501, uses7d: 3, automations: [{ id: "auto", name: "Boas-vindas", status: "active" }] });
  for (const call of state.calls) {
    expect(call.filters).toContainEqual(["organization_id", "org"]);
    expect(call.columns).not.toBe("*");
  }
  const counts = state.calls.filter((call) => call.table === "entry_link_hits");
  expect(counts).toHaveLength(2);
  for (const call of counts) {
    expect(call.options).toEqual({ count: "exact", head: true });
    expect(call.filters).toContainEqual(["link_id", "link"]);
  }
  expect(counts[1].filters).toContainEqual(["created_at", "2026-10-07T12:00:00.000Z"]);
  expect(state.calls.find((call) => call.table === "automations")?.filters).toContainEqual(["trigger_type", "entry_link"]);
});
test("consulta falha em vez de apresentar uma lista vazia enganosa", async () => {
  state.error = { code: "42501" };
  await expect(listEntryLinks("org")).rejects.toEqual({ code: "42501" });
});
