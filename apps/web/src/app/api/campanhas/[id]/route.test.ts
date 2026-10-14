import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  org: { id: "org-a", role: "agent" } as { id: string; role: string } | null,
  status: "sent",
  campaignOrg: "org-a",
  rpc: vi.fn(),
}));

vi.mock("@/lib/org/active-org", () => ({ getActiveOrg: async () => state.org }));
vi.mock("@/lib/growth/actions", () => ({ deleteCampaign: vi.fn(), saveCampaignDraft: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    rpc: state.rpc,
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const campaign = {
        id: "campaign-a", name: "Campanha", status: state.status, audience: {}, message: {},
        scheduled_at: null, finished_at: null, created_at: "2026-10-14", updated_at: "2026-10-14",
      };
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
        order: () => builder,
        maybeSingle: async () => ({
          data: table === "campaigns" && filters.organization_id === state.campaignOrg && filters.id === campaign.id
            ? campaign : null,
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return builder;
    },
  }),
}));

import { GET } from "./route";

describe("GET campaign report pagination", () => {
  beforeEach(() => {
    state.org = { id: "org-a", role: "agent" };
    state.status = "sent";
    state.campaignOrg = "org-a";
    state.rpc.mockReset().mockImplementation(async (_name, args) => ({
      data: { counts: {}, clicks: {}, recipients: [{ id: `recipient-${args.p_offset}` }] }, error: null,
    }));
  });

  it.each([
    ["", 50, 0], ["?limit=50&offset=0", 50, 0], ["?limit=50&offset=50", 50, 50],
    ["?limit=1&offset=1", 1, 1], ["?limit=100&offset=2147483647", 100, 2147483647],
    ["?limit=0&offset=-1", 50, 0], ["?limit=-5&offset=-50", 50, 0],
    ["?limit=abc&offset=abc", 50, 0], ["?limit=5.5&offset=2.5", 50, 0],
    ["?limit=10foo&offset=50foo", 50, 0], ["?limit=1e2&offset=1e2", 50, 0],
    ["?limit=&offset=", 50, 0], ["?limit=500&offset=2147483648", 100, 2147483647],
    ["?limit=99999999999999999999&offset=99999999999999999999", 50, 0],
  ])("passes safe URL pagination to RPC: %s", async (query, limit, offset) => {
    const response = await GET(new Request(`http://localhost/api/campanhas/campaign-a${query}`), {
      params: Promise.resolve({ id: "campaign-a" }),
    });
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("campaign_report", { p_id: "campaign-a", p_limit: limit, p_offset: offset });
    const payload = await response.json();
    expect(payload.report.recipients[0].id).toBe(`recipient-${offset}`);
    expect(payload.canWrite).toBe(false);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 401 before reading reports without active membership", async () => {
    state.org = null;
    const response = await GET(new Request("http://localhost/api/campanhas/campaign-a?offset=50"), {
      params: Promise.resolve({ id: "campaign-a" }),
    });
    expect(response.status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("does not fetch reports for a campaign outside the active organization", async () => {
    state.campaignOrg = "org-b";
    const response = await GET(new Request("http://localhost/api/campanhas/campaign-a?offset=50"), {
      params: Promise.resolve({ id: "campaign-a" }),
    });
    expect(response.status).toBe(404);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("does not fetch a report for drafts", async () => {
    state.status = "draft";
    const response = await GET(new Request("http://localhost/api/campanhas/campaign-a?offset=50"), {
      params: Promise.resolve({ id: "campaign-a" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).report).toBeNull();
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
