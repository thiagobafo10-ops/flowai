import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_GRANTS } from "./lib/default-grants.mjs";
import { captureStates, pidAlive, quote, recoverStaleRun, restoreStates, vaultMarkerStore } from "./lib/harness-state.mjs";
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
  source.setEncoding("utf8"); // multi-byte characters split across chunks stay intact
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
async function assertPortFree(candidate) {
  const inUse = await new Promise((resolve) => {
    const probe = net.connect(candidate, "127.0.0.1");
    probe.once("connect", () => { probe.destroy(); resolve(true); });
    probe.once("error", () => resolve(false));
  });
  if (inUse) throw new Error(`A porta ${candidate} já está em uso.`);
}
const KINDS = ["automation", "ai", "instagram"];
const marker = vaultMarkerStore(sql);
let previous = null; // captured worker states; also persisted in the Vault marker
let proxy; let test;
let ownsRun = false; // false while refusing a busy port: another run may hold a fixture.
// Synchronous so it can also run from the process "exit" handler; called exactly once.
// Returns false on failure so a signal exit becomes 1 instead of 130/143.
function restore() {
  if (!ownsRun) return true;
  let ok = true;
  // Fixtures revoking shared privileges may have been interrupted; globalSetup heals the next run.
  try { sql(DEFAULT_GRANTS); } catch {
    console.error("Falha ao restaurar privilégios padrão; confira o banco local.");
    ok = false;
  }
  if (!previous) return ok;
  // Restore Vault values/config before re-enabling crons. Secrets stay only in memory/Vault.
  let failed;
  try { failed = restoreStates(sql, previous); } catch { failed = KINDS; }
  for (const kind of failed) console.error(`Falha ao restaurar configuração/cron ${kind}; confira o banco local.`);
  if (failed.length) return false; // keep the marker: the next run retries the recovery
  try { marker.clear(); } catch { console.error("Falha ao remover o marcador do harness."); return false; }
  return ok;
}
// Cancellation waits (bounded) for Playwright to stop the Next server and browsers it owns,
// force-kills only the trees this script spawned, then restores once. Proxy goes last.
const cancellation = createCancellation({ children: () => [test, { child: proxy, graceMs: 2_000 }], restore });
installCancellation(cancellation);
try {
  await assertPortFree(port); await assertPortFree(webPort);
  console.log(`E2E local sequencial; memória livre: ${Math.round(os.freemem() / 1024 / 1024)} MB.`);
  const supabase = path.join(root, "node_modules/supabase/dist/supabase.js");
  // CLI status may contain keys even on stderr: never inherit either output stream.
  let status;
  try { status = JSON.parse(execFileSync(process.execPath, [supabase, "status", "-o", "json"], { cwd: root, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] })); }
  catch { throw new Error("Supabase local indisponível; inicie-o antes do E2E."); }
  if (new URL(status.API_URL).hostname !== "127.0.0.1") throw new Error("Este teste exige o Supabase local.");
  // A run killed without its finally left a marker: restore its saved state first.
  const stale = recoverStaleRun({ store: marker, restore: (states) => restoreStates(sql, states), isAlive: pidAlive });
  if (stale.recovered) console.log(`Estado de execução interrompida restaurado: ${stale.kinds.join(", ")}.`);
  ownsRun = true; // from here on this run owns the shared state it restores
  const captured = captureStates(sql, KINDS);
  marker.write({ pid: process.pid, startedAt: Date.now(), suite: instagram ? "instagram" : "automation", states: captured });
  previous = captured; // only now may restore() clear the marker
  for (const kind of KINDS) {
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
finally { if (!await cancellation.shutdown({ grace: 0 })) process.exitCode = 1; }
