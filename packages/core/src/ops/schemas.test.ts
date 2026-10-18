import { describe, expect, it } from "vitest";
import { opsHealthSchema } from "./schemas.ts";

const sample = {
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
        webhook_verified_at: null,
        disconnected_at: null,
        last_error: null,
      },
    },
  ],
  instagram_events: {
    pending: 0,
    uncertain: 1,
    failed: 2,
    ignored_24h: 3,
    pending_24h: 10,
    oldest_pending_at: null,
    top_errors: [{ code: "comment_not_eligible", count: 2 }],
  },
  send_intents: {
    pending: 1,
    sending: 0,
    failed: 2,
    uncertain: 0,
    sent_24h: 5,
    top_errors: [{ code: "rate_limited", count: 2 }],
  },
  automation_runs: { pending: 0, running: 1, waiting: 2, failed_24h: 1, stalled: 0 },
  ai_jobs: { pending: 1, running: 0, failed_24h: 0, stuck: 0 },
  vip: [
    {
      channel_id: "ch1",
      enabled: true,
      last_error: null,
      comments_error: null,
      comments_verified_at: "2026-10-17T16:00:00.000Z",
    },
  ],
};

describe("opsHealthSchema", () => {
  it("aceita o retorno de ops_health", () => {
    const parsed = opsHealthSchema.parse(sample);
    expect(parsed.channels[0]?.status).toBe("active");
    expect(parsed.instagram_events.top_errors[0]?.count).toBe(2);
  });

  it("converte contadores enviados como texto (bigint do Postgres)", () => {
    const parsed = opsHealthSchema.parse({
      ...sample,
      send_intents: { ...sample.send_intents, failed: "2", sent_24h: "0" },
    });
    expect(parsed.send_intents.failed).toBe(2);
    expect(parsed.send_intents.sent_24h).toBe(0);
  });

  it("rejeita status de canal desconhecido", () => {
    const bad = { ...sample, channels: [{ ...sample.channels[0], status: "broken" }] };
    expect(opsHealthSchema.safeParse(bad).success).toBe(false);
  });
});
