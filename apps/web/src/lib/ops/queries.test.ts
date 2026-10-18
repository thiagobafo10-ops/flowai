import { describe, expect, it, vi } from "vitest";
import { getOpsHealth, type SupabaseRpcClient } from "./queries";

const payload = {
  generated_at: "2026-10-17T18:00:00.000Z",
  timezone: "America/Sao_Paulo",
  channels: [
    {
      id: "ch1",
      name: "Instagram",
      type: "instagram",
      status: "active",
      last_error: null,
      updated_at: "2026-10-17T17:00:00.000Z",
      connection: {
        id: "conn1",
        app_id: "123",
        api_version: "v26.0",
        credential_generation: 1,
        token_verified_at: "2026-10-17T16:00:00.000Z",
        webhook_verified_at: "2026-10-17T16:00:00.000Z",
        disconnected_at: null,
        last_error: null,
      },
    },
  ],
  instagram_events: {
    pending: 0,
    uncertain: 0,
    failed: 0,
    ignored_24h: 0,
    pending_24h: 4,
    oldest_pending_at: null,
    top_errors: [],
  },
  send_intents: {
    pending: 0,
    sending: 0,
    failed: 0,
    uncertain: 0,
    sent_24h: 3,
    top_errors: [],
  },
  automation_runs: { pending: 0, running: 0, waiting: 0, failed_24h: 0, stalled: 0 },
  ai_jobs: { pending: 0, running: 0, failed_24h: 0, stuck: 0 },
  vip: [],
};

describe("getOpsHealth", () => {
  it("chama a rpc ops_health com a organização e valida a resposta", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: payload, error: null });
    const mockClient = { rpc: mockRpc } as unknown as SupabaseRpcClient;

    const result = await getOpsHealth("org-123", mockClient);

    expect(mockRpc).toHaveBeenCalledWith("ops_health", { p_org: "org-123" });
    expect(result.channels[0]?.name).toBe("Instagram");
    expect(result.send_intents.sent_24h).toBe(3);
  });

  it("lança erro quando a rpc retorna erro", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "forbidden" } });
    const mockClient = { rpc: mockRpc } as unknown as SupabaseRpcClient;

    await expect(getOpsHealth("org-123", mockClient)).rejects.toThrow(
      "Falha ao carregar a saúde da operação",
    );
  });

  it("lança erro quando o formato da resposta é inválido", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: { generated_at: "x" }, error: null });
    const mockClient = { rpc: mockRpc } as unknown as SupabaseRpcClient;

    await expect(getOpsHealth("org-123", mockClient)).rejects.toThrow("Resposta inválida de ops_health");
  });
});
