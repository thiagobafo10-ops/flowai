import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { automationAiOutputSchema, type AutomationGraph } from "@flowai/core";

const state = vi.hoisted(() => ({
  role: "admin",
  tables: {} as Record<string, unknown[]>,
  apiKey: "test-openai-key",
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/org/active-org", () => ({
  getActiveOrg: async () => ({ id: "00000000-0000-4000-8000-000000000001", role: state.role }),
}));

vi.mock("@/lib/supabase/server", () => {
  function builder(table: string) {
    const rows = () => state.tables[table] ?? [];
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null });
    return b;
  }
  return {
    createServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
      from: (table: string) => builder(table),
    }),
  };
});

import { generateAutomationWithAi } from "./ai-actions";

describe("generateAutomationWithAi", () => {
  beforeEach(() => {
    state.role = "admin";
    state.apiKey = "test-openai-key";
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_CHAT_MODEL", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    state.tables = {
      tags: [{ id: "11111111-1111-4000-8000-000000000001", name: "VIP" }],
      pipelines: [{ id: "22222222-2222-4000-8000-000000000001", is_default: true }],
      pipeline_stages: [{ id: "33333333-3333-4000-8000-000000000001", name: "Primeiro Contato", is_won: false, is_lost: false }],
      channels: [{ id: "44444444-4444-4000-8000-000000000001", name: "Instagram", type: "instagram" }],
      memberships: [{ user_id: "55555555-5555-4000-8000-000000000001", profiles: { full_name: "Atendente 1" } }],
      sequences: [{ id: "66666666-6666-4000-8000-000000000001", name: "Nutrição" }],
      entry_links: [{ id: "77777777-7777-4000-8000-000000000001", name: "Link Bio" }],
    };
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([false, true])("instrui JSON com contrato completo na chamada real da action (refinamento=%s)", async (refining) => {
    const currentGraph: AutomationGraph = {
      nodes: [{ id: "trigger", type: "trigger", config: {}, position: { x: 0, y: 0 } }],
      edges: [],
    };
    let requestBody = "";
    const customFetch: typeof fetch = async (_url, options) => {
      requestBody = String(options?.body);
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        name: "Boas-vindas", triggerType: "message_received", triggerConfig: { firstMessageOnly: false },
        explanation: "Recebe e termina.",
        nodes: [{ id: "trigger", type: "trigger", config: {} }, { id: "end", type: "end", config: {} }],
        edges: [{ source: "trigger", target: "end", sourceHandle: "default" }],
      }) } }] });
    };
    const result = await generateAutomationWithAi({
      prompt: "Criar fluxo de boas-vindas", ...(refining ? { currentGraph } : {}),
    }, { fetchFn: customFetch });
    expect(result.ok).toBe(true);
    const request = JSON.parse(requestBody);
    expect(request.model).toBe("gpt-4.1-mini");
    expect(request.response_format).toEqual({ type: "json_object" });
    const system = request.messages.find((m: { role: string }) => m.role === "system").content;
    expect(system).toMatch(/JSON/);
    expect(system).toMatch(/(?:somente|apenas|exclusivamente).*JSON/i);
    // O exemplo fornecido ao modelo deve ser consumível pelo schema de saída.
    const sample = system.match(/```json\s*([\s\S]*?)```/);
    expect(sample, "instrução precisa mostrar a estrutura JSON de saída").not.toBeNull();
    expect(automationAiOutputSchema.safeParse(JSON.parse(sample![1])).success).toBe(true);
    if (result.ok) expect(result.data.issues).toEqual([]);
  });

  it("rejeita requisições de agentes ou membros sem permissão de escrita", async () => {
    state.role = "agent";
    const res = await generateAutomationWithAi({ prompt: "Criar fluxo de boas-vindas" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Você não tem permissão para esta ação.");
  });

  it("valida o tamanho mínimo do prompt", async () => {
    const res = await generateAutomationWithAi({ prompt: "oi" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("pelo menos 3 caracteres");
  });

  it("gera o fluxo com IA e retorna grafo sanitizado com layout aplicado", async () => {
    const mockOutput = {
      name: "Fluxo Boas-vindas VIP",
      triggerType: "message_received",
      triggerConfig: { firstMessageOnly: true },
      explanation: "Recebe o contato e manda mensagem de boas-vindas.",
      nodes: [
        { id: "trig", type: "trigger", config: {} },
        { id: "msg", type: "message", config: { mode: "text", text: "Olá! Seja bem-vindo." } },
        { id: "fim", type: "end", config: {} },
      ],
      edges: [
        { source: "trig", target: "msg", sourceHandle: "default" },
        { source: "msg", target: "fim", sourceHandle: "default" },
      ],
    };

    const customFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(mockOutput),
            },
          },
        ],
      }),
    });

    const res = await generateAutomationWithAi(
      { prompt: "Quando mandar primeira mensagem, dar boas-vindas e encerrar" },
      { fetchFn: customFetch as unknown as typeof fetch },
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.name).toBe("Fluxo Boas-vindas VIP");
      expect(res.data.triggerType).toBe("message_received");
      expect(res.data.graph.nodes).toHaveLength(3);
      expect(res.data.graph.edges).toHaveLength(2);
      expect(res.data.graph.nodes[0]!.position.y).toBeLessThan(res.data.graph.nodes[1]!.position.y);
    }
  });

  it("retorna erro amigável se a API da OpenAI falhar", async () => {
    const customFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "internal" }),
    });

    const res = await generateAutomationWithAi(
      { prompt: "Criar fluxo automático" },
      { fetchFn: customFetch as unknown as typeof fetch },
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("Não foi possível gerar a automação com a IA. Tente reformular o pedido.");
    }
  });
});
