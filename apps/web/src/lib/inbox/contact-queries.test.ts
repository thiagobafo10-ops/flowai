import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as [string, ...unknown[]][],
  classification: null as null | { intent: string; sentiment: string; summary: string },
  classificationError: null as null | { code: string },
}));
vi.mock("@/lib/crm/queries", () => ({
  getContact: async () => ({ deals: [] }),
  listTags: async () => [],
  listMembers: async () => [],
  getBoard: async () => ({ stages: [], deals: [] }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => { state.calls.push([`${table}.eq`, c, v]); return q; },
        order: (c: string, o: unknown) => { state.calls.push([`${table}.order`, c, o]); return q; },
        limit: (n: number) => { state.calls.push([`${table}.limit`, n]); return q; },
        maybeSingle: async () => table === "ai_classifications"
          ? { data: state.classification, error: state.classificationError }
          : { data: { id: "c" }, error: null },
      };
      return q;
    },
  }),
}));
import { getContactPanel } from "./contact-queries";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const CONTACT = "00000000-0000-4000-8000-0000000000bb";
const CONV = "00000000-0000-4000-8000-0000000000cc";
beforeEach(() => { state.calls = []; state.classification = null; state.classificationError = null; });

test("reads the latest classification scoped to organization and conversation", async () => {
  state.classification = { intent: "preço", sentiment: "positive", summary: "Quer saber o preço" };
  const panel = await getContactPanel(ORG, CONTACT, CONV);
  expect(panel?.intelligence).toEqual({ intent: "preço", sentiment: "positive", summary: "Quer saber o preço" });
  const calls = state.calls.filter(([k]) => k.startsWith("ai_classifications"));
  expect(calls).toEqual([
    ["ai_classifications.eq", "organization_id", ORG],
    ["ai_classifications.eq", "conversation_id", CONV],
    ["ai_classifications.order", "created_at", { ascending: false }],
    ["ai_classifications.order", "id", { ascending: false }],
    ["ai_classifications.limit", 1],
  ]);
});
test("no classification yields empty intelligence", async () => {
  expect((await getContactPanel(ORG, CONTACT, CONV))?.intelligence).toEqual({ intent: null, sentiment: null, summary: null });
});
test("classification read error throws", async () => {
  state.classificationError = { code: "XX000" };
  await expect(getContactPanel(ORG, CONTACT, CONV)).rejects.toThrow("Falha ao carregar classificação");
});
