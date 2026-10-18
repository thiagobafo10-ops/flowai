import { describe, expect, it } from "vitest";
import type { OpsHealth } from "@flowai/core";
import { formatStamp, healthIssues } from "./health-view";

function healthy(overrides: Partial<OpsHealth> = {}): OpsHealth {
  return {
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
    send_intents: { pending: 0, sending: 0, failed: 0, uncertain: 0, sent_24h: 3, top_errors: [] },
    automation_runs: { pending: 0, running: 0, waiting: 0, failed_24h: 0, stalled: 0 },
    ai_jobs: { pending: 0, running: 0, failed_24h: 0, stuck: 0 },
    vip: [],
    ...overrides,
  };
}

describe("healthIssues", () => {
  it("não aponta nada quando a operação está saudável", () => {
    expect(healthIssues(healthy())).toEqual([]);
  });

  it("detecta a fila de eventos parada há mais de 5 minutos", () => {
    const issues = healthIssues(
      healthy({
        instagram_events: { ...healthy().instagram_events, pending: 3, oldest_pending_at: "2026-10-17T17:40:00.000Z" },
      }),
    );
    expect(issues.some((i) => i.severity === "critical" && i.message.includes("mais de 5 minutos"))).toBe(true);
  });

  it("não marca pendente recente como travado", () => {
    const issues = healthIssues(
      healthy({
        instagram_events: { ...healthy().instagram_events, pending: 1, oldest_pending_at: "2026-10-17T17:59:30.000Z" },
      }),
    );
    expect(issues).toEqual([]);
  });

  it("aponta envios, execuções, IA e canal com erro", () => {
    const issues = healthIssues(
      healthy({
        send_intents: { ...healthy().send_intents, failed: 2, uncertain: 1 },
        automation_runs: { ...healthy().automation_runs, stalled: 1 },
        ai_jobs: { ...healthy().ai_jobs, stuck: 1 },
        channels: [{ ...healthy().channels[0]!, status: "error" }],
      }),
    );
    const messages = issues.map((i) => i.message).join(" | ");
    expect(messages).toContain("2 envio(s)");
    expect(messages).toContain("incerto");
    expect(messages).toContain("travada(s)");
    expect(messages).toContain("está com erro");
  });

  it("aponta conexão desconectada", () => {
    const channel = healthy().channels[0]!;
    const issues = healthIssues(
      healthy({
        channels: [{ ...channel, connection: { ...channel.connection!, disconnected_at: "2026-10-17T17:00:00.000Z" } }],
      }),
    );
    expect(issues.some((i) => i.message.includes("desconectada"))).toBe(true);
  });
});

describe("formatStamp", () => {
  it("usa o fuso da organização", () => {
    const out = formatStamp("2026-10-17T18:00:00.000Z", "America/Sao_Paulo");
    expect(out).toContain("17/10");
    expect(out).toContain("15:00");
  });

  it("devolve travessão para vazio ou inválido", () => {
    expect(formatStamp(null, "America/Sao_Paulo")).toBe("—");
    expect(formatStamp("não é data", "America/Sao_Paulo")).toBe("—");
  });
});
