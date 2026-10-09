import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Apenas para e2e: acessa o Postgres do Supabase LOCAL via docker exec.
const DB_CONTAINER = "supabase_db_flowai";
const DOCKER_BIN = path.join(
  process.env.LOCALAPPDATA ?? "",
  "Programs",
  "DockerDesktop",
  "resources",
  "bin",
);

function readSupabaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NEXT_PUBLIC_SUPABASE_URL;
  const envFile = path.join(__dirname, "..", "..", ".env.local");
  const m = fs.readFileSync(envFile, "utf8").match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m);
  return m?.[1]?.trim() ?? "";
}

export function assertLocalSupabase(): void {
  const url = readSupabaseUrl();
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {}
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`e2e abortado: Supabase não é local (${url || "URL ausente"}).`);
  }
}

export function psql(sql: string): string {
  assertLocalSupabase();
  const sep = process.platform === "win32" ? ";" : ":";
  return execFileSync(
    "docker",
    ["exec", DB_CONTAINER, "psql", "-U", "postgres", "-tA", "-c", sql],
    { env: { ...process.env, PATH: `${DOCKER_BIN}${sep}${process.env.PATH}` }, encoding: "utf8" },
  ).trim();
}

export function clearRateLimits(): void {
  psql("delete from public.rate_limits");
}

export function countMemberships(email: string): number {
  if (!/^[\w.+@-]+$/.test(email)) throw new Error("e-mail inválido para helper");
  return Number(
    psql(
      `select count(*) from public.memberships m join auth.users u on u.id = m.user_id where u.email = '${email}'`,
    ),
  );
}
