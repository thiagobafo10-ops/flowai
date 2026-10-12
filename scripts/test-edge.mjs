import { spawnSync } from "node:child_process";
const result = spawnSync(process.env.DENO_BIN ?? "deno", ["test", "--config", "supabase/functions/deno.json", "--allow-env", "--allow-read", "supabase/functions/tests/", ...process.argv.slice(2)], { stdio: "inherit", shell: false });
if (result.error) console.error("Deno não encontrado. Instale Deno 2 ou configure DENO_BIN.");
process.exitCode = result.status ?? 1;
