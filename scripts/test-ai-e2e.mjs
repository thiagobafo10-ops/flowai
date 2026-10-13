import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const deno = process.env.DENO_BIN ?? "deno";
const supabase = path.join(root, "node_modules/supabase/dist/supabase.js");
const env = { ...process.env };
if (process.platform === "win32") {
  const inheritedPath = process.env.PATH ?? process.env.Path ?? "";
  for (const name of Object.keys(env)) if (name.toLowerCase() === "path") delete env[name];
  env.PATH = `${path.join(env.LOCALAPPDATA ?? "", "Programs/DockerDesktop/resources/bin")};${inheritedPath}`;
}
function sql(text) {
  const result = spawnSync("docker", ["exec", "-i", "supabase_db_flowai", "psql", "-U", "postgres", "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1"], { input: text, encoding: "utf8", env });
  if (result.status !== 0) throw new Error("Falha na preparação do banco local de testes.");
  return result.stdout.trim();
}
const jobs = ["flowai-ai-worker", "flowai-instagram-worker"];
const previousActive = new Map();
let proxy; let test;
async function cleanup() {
  if (proxy && !proxy.killed) proxy.kill();
  for (const [job, active] of previousActive) {
    try { sql(`select cron.alter_job(jobid,active:=${active}) from cron.job where jobname='${job}';`); } catch { console.error("Confira o estado do cron local após o teste."); }
  }
}
process.once("SIGINT", async () => { test?.kill(); await cleanup(); process.exit(130); });
process.once("SIGTERM", async () => { test?.kill(); await cleanup(); process.exit(143); });
try {
  const status = JSON.parse(execFileSync(process.execPath, [supabase, "status", "-o", "json"], { cwd: root, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }));
  if (new URL(status.API_URL).hostname !== "127.0.0.1") throw new Error("Este teste exige o Supabase local.");
  for (const job of jobs) {
    const active = sql(`select active from cron.job where jobname='${job}';`);
    if (!active) continue;
    previousActive.set(job, active === "t");
    sql(`select cron.alter_job(jobid,active:=false) from cron.job where jobname='${job}';`);
  }
  const key = status.SERVICE_ROLE_KEY.replaceAll("'", "''");
  sql(`select public.configure_ai_worker('http://supabase_kong_flowai:8000','${key}','${randomBytes(32).toString("hex")}');`);
  proxy = spawn(deno, ["run", "--config", "supabase/functions/deno.json", "--allow-net", "--allow-env", "--allow-read", "supabase/functions/tests/serve-ai-e2e.ts"], { cwd: root, env: { ...env, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, SUPABASE_ANON_KEY: status.ANON_KEY }, stdio: ["ignore", "ignore", "pipe"], shell: false });
  let proxyError = false;
  proxy.on("error", () => { proxyError = true; });
  // Do not print process environment or database statements containing secrets.
  proxy.stderr.on("data", () => {});
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (proxyError || proxy.exitCode !== null) throw new Error("Não foi possível iniciar o proxy Deno de testes.");
    try { ready = (await fetch("http://127.0.0.1:54327/__test__/openai-calls")).ok; } catch { /* process starting */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error("O proxy de testes não iniciou.");
  const cli = path.join(path.dirname(require.resolve("@playwright/test/package.json")), "cli.js");
  test = spawn(process.execPath, [cli, "test", "--config", "playwright.ai.config.ts", ...process.argv.slice(2)], { cwd: path.join(root, "apps/web"), env, stdio: "inherit", shell: false });
  process.exitCode = await new Promise((resolve) => { test.on("error", () => resolve(1)); test.on("exit", (code) => resolve(code ?? 1)); });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha no teste local."); process.exitCode = 1;
} finally { await cleanup(); }
