import { z } from "zod";

/** Contadores podem chegar como número ou string (bigint do Postgres). */
const numeric = z.union([
  z.number().finite(),
  z
    .string()
    .refine((v) => v.trim() !== "" && Number.isFinite(Number(v)), "invalid number")
    .transform((v) => Number(v)),
]);

const timestamp = z.string().nullable();

export const opsChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.enum(["needs_setup", "active", "error"]),
  last_error: z.string().nullable(),
  updated_at: z.string(),
  connection: z
    .object({
      id: z.string(),
      app_id: z.string(),
      api_version: z.string(),
      credential_generation: numeric,
      token_verified_at: timestamp,
      webhook_verified_at: timestamp,
      disconnected_at: timestamp,
      last_error: z.string().nullable(),
    })
    .nullable(),
});

export const opsErrorCountSchema = z.object({ code: z.string(), count: numeric });

export const opsHealthSchema = z.object({
  generated_at: z.string(),
  timezone: z.string(),
  channels: z.array(opsChannelSchema),
  instagram_events: z.object({
    pending: numeric,
    uncertain: numeric,
    failed: numeric,
    ignored_24h: numeric,
    pending_24h: numeric,
    oldest_pending_at: timestamp,
    top_errors: z.array(opsErrorCountSchema),
  }),
  send_intents: z.object({
    pending: numeric,
    sending: numeric,
    failed: numeric,
    uncertain: numeric,
    sent_24h: numeric,
    top_errors: z.array(opsErrorCountSchema),
  }),
  automation_runs: z.object({
    pending: numeric,
    running: numeric,
    waiting: numeric,
    failed_24h: numeric,
    stalled: numeric,
  }),
  ai_jobs: z.object({
    pending: numeric,
    running: numeric,
    failed_24h: numeric,
    stuck: numeric,
  }),
  vip: z.array(
    z.object({
      channel_id: z.string(),
      enabled: z.boolean(),
      last_error: z.string().nullable(),
      comments_error: z.string().nullable(),
      comments_verified_at: timestamp,
    }),
  ),
});

export type OpsHealth = z.infer<typeof opsHealthSchema>;
export type OpsChannel = z.infer<typeof opsChannelSchema>;
export type OpsErrorCount = z.infer<typeof opsErrorCountSchema>;
