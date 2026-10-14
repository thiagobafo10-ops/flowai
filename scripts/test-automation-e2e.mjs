import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCancellation, installCancellation } from "./lib/owned-process.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const instagram = process.env.FLOWAI_E2E_SUITE === "instagram";
const port = instagram ? 54326 : 54328;
const webPort = instagram ? 3101 : 3103;
const env = { ...process.env, FLOWAI_E2E_PROXY_PORT: String(port), FLOWAI_E2E_PROXY_URL: `http://127.0.0.1:${port}` };
if (process.platform === "win32") {
  const inheritedPath = process.env.PATH ?? process.env.Path ?? "";
  for (const name of Object.keys(env)) if (name.toLowerCase() === "path") delete env[name];
  env.PATH = `${path.join(env.LOCALAPPDATA ?? "", "Programs/DockerDesktop/resources/bin")};${inheritedPath}`;
}
const sanitize = (value) => String(value).replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[supabase-key]").replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]").replace(/[A-Fa-f0-9]{32,}/g, "[hex]");
// Buffer complete lines so credentials split across child-process chunks are masked too.
function pipeSanitized(source, target) {
  let pending = "";
  source.on("data", (chunk) => {
    pending += chunk;
    const newline = pending.lastIndexOf("\n");
    if (newline < 0) return;
    target.write(sanitize(pending.slice(0, newline + 1)));
    pending = pending.slice(newline + 1);
  });
  source.on("end", () => { if (pending) target.write(sanitize(pending)); });
}
function sql(statement) {
  const result = spawnSync("docker", ["exec", "-i", "supabase_db_flowai", "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1"], { input: statement, encoding: "utf8", env });
  if (result.status !== 0) throw new Error("Falha no banco local de testes.");
  return result.stdout.trim();
}
const quote = (text) => "'" + text.replaceAll("'", "''") + "'";
function readConfig(kind) {
  const value = sql(`select json_build_object('baseUrl',c.base_url,'serviceKey',s.decrypted_secret,'workerSecret',w.decrypted_secret) from private.${kind}_worker_config c join vault.decrypted_secrets s on s.id=c.service_key_secret_id join vault.decrypted_secrets w on w.id=c.worker_secret_id;`);
  return value ? JSON.parse(value) : null;
}
async function assertPortFree(candidate) {
  const inUse = await new Promise((resolve) => {
    const probe = net.connect(candidate, "127.0.0.1");
    probe.once("connect", () => { probe.destroy(); resolve(true); });
    probe.once("error", () => resolve(false));
  });
  if (inUse) throw new Error(`A porta ${candidate} já está em uso.`);
}
const previous = new Map();
let proxy; let test;
// Shared-DB privileges toggled by dashboard/hardening fixtures; an interrupted fixture may skip
// its finally, so the canonical grants are ensured before the run and again on restoration.
const DEFAULT_GRANTS = "grant select on public.memberships to authenticated; grant execute on function public.dashboard_metrics(uuid, int) to authenticated;";
let ownsRun = false; // false while refusing a busy port: another run may hold a fixture.
function ensureDefaultGrants() {
  try { sql(DEFAULT_GRANTS); } catch {
    console.error("Falha ao restaurar privilégios padrão; confira o banco local.");
    process.exitCode = 1;
  }
}
// Synchronous so it can also run from the process "exit" handler; called exactly once.
function restore() {
  if (ownsRun) ensureDefaultGrants();
  // Restore Vault values/config before re-enabling crons. Secrets stay only in memory.
  {
    for (const [kind, state] of previous) {
      try {
        if (state.config) sql(`select public.configure_${kind}_worker(${quote(state.config.baseUrl)},${quote(state.config.serviceKey)},${quote(state.config.workerSecret)});`);
        else sql(`with removed as (delete from private.${kind}_worker_config returning service_key_secret_id,worker_secret_id) delete from vault.secrets where id in (select service_key_secret_id from removed union all select worker_secret_id from removed);`);
        if (state.active !== null) sql(`select cron.alter_job(jobid,active:=${state.active}) from cron.job where jobname='flowai-${kind}-worker';`);
        if (JSON.stringify(readConfig(kind)) !== JSON.stringify(state.config)) throw new Error("config restoration mismatch");
        if (state.active !== null && sql(`select active from cron.job where jobname='flowai-${kind}-worker';`) !== (state.active ? "t" : "f")) throw new Error("cron restoration mismatch");
      } catch {
        console.error(`Falha ao restaurar configuração/cron ${kind}; confira o banco local.`);
        process.exitCode = 1;
      }
    }
  }
}
// Cancellation waits (bounded) for Playwright to stop the Next server and browsers it owns,
// force-kills only the trees this script spawned, then restores once. Proxy goes last.
const cancellation = createCancellation({ children: () => [test, { child: proxy, graceMs: 2_000 }], restore });
installCancellation(cancellation);
try {
  await assertPortFree(port); await assertPortFree(webPort);
  ownsRun = true;
  ensureDefaultGrants();
  console.log(`E2E local sequencial; memória livre: ${Math.round(os.freemem() / 1024 / 1024)} MB.`);
  const supabase = path.join(root, "node_modules/supabase/dist/supabase.js");
  // CLI status may contain keys even on stderr: never inherit either output stream.
  let status;
  try { status = JSON.parse(execFileSync(process.execPath, [supabase, "status", "-o", "json"], { cwd: root, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] })); }
  catch { throw new Error("Supabase local indisponível; inicie-o antes do E2E."); }
  if (new URL(status.API_URL).hostname !== "127.0.0.1") throw new Error("Este teste exige o Supabase local.");
  for (const kind of ["automation", "ai", "instagram"]) {
    const active = sql(`select active from cron.job where jobname='flowai-${kind}-worker';`);
    previous.set(kind, { active: active ? active === "t" : null, config: readConfig(kind) });
    sql(`select cron.alter_job(jobid,active:=false) from cron.job where jobname='flowai-${kind}-worker';`);
    sql(`select public.configure_${kind}_worker('http://supabase_kong_flowai:8000',${quote(status.SERVICE_ROLE_KEY)},${quote(randomBytes(32).toString("hex"))});`);
  }
  proxy = spawn(process.env.DENO_BIN ?? "deno", ["run", "--config", "supabase/functions/deno.json", `--allow-net=127.0.0.1:54321,127.0.0.1:${port}`, "--allow-env", "--allow-read", "supabase/functions/tests/serve-automation-e2e.ts"], { cwd: root, env: { ...env, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, SUPABASE_ANON_KEY: status.ANON_KEY }, stdio: ["ignore", "ignore", "pipe"], shell: false });
  let proxyError = false; let stderrTail = "";
  proxy.on("error", () => { proxyError = true; });
  proxy.stderr.on("data", (chunk) => { stderrTail = (stderrTail + chunk).slice(-4000); });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (proxyError || proxy.exitCode !== null) throw new Error(`Não foi possível iniciar o proxy Deno.\n${sanitize(stderrTail)}`);
    try { ready = (await fetch(`${env.FLOWAI_E2E_PROXY_URL}/__test__/graph-calls`)).ok; } catch { /* starting */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`O proxy de testes não iniciou.\n${sanitize(stderrTail)}`);
  const cli = path.join(path.dirname(require.resolve("@playwright/test/package.json")), "cli.js");
  test = spawn(process.execPath, [cli, "test", "--config", instagram ? "playwright.integration.config.ts" : "playwright.automation.config.ts", ...process.argv.slice(2)], { cwd: path.join(root, "apps/web"), env, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: process.platform !== "win32" });
  pipeSanitized(test.stdout, process.stdout);
  pipeSanitized(test.stderr, process.stderr);
  process.exitCode = await new Promise((resolve) => { test.on("error", () => resolve(1)); test.on("exit", (code) => resolve(code ?? 1)); });
} catch (error) { console.error(sanitize(error instanceof Error ? error.message : "Falha no teste local.")); process.exitCode = 1; }
// Normal end: Playwright already stopped its own tree; stop the proxy and restore once.
finally { await cancellation.shutdown({ grace: 0 }); }
