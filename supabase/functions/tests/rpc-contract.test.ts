// Contract: every rpc("name", { p_...: ... }) call made by the Edge Functions uses argument names that
// exist in the latest SQL definition of public.<name> (PostgREST resolves functions by argument names,
// so a wrong name is a 404 at runtime and never a type error).

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }

type Param = { name: string; hasDefault: boolean };

function balanced(source: string, openIndex: number, open: string, close: string): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0) return source.slice(openIndex + 1, i);
  }
  throw new Error(`unbalanced ${open}${close}`);
}

function splitTopLevel(list: string): string[] {
  const out: string[] = []; let depth = 0; let current = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(current); current = ""; } else current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

function parseParams(list: string): Param[] {
  return splitTopLevel(list).map((raw) => raw.replace(/--[^\n]*/g, "").trim()).filter(Boolean).flatMap((p) => {
    const words = p.split(/\s+/);
    if (/^out$/i.test(words[0]!)) return [];
    if (/^(in|inout)$/i.test(words[0]!)) words.shift();
    return [{ name: words[0]!.toLowerCase(), hasDefault: /\sdefault\s|=/i.test(p) }];
  });
}

/** name → overloads (latest definition per argument list wins; migrations applied in file order). */
async function sqlSignatures(): Promise<Map<string, Map<string, Param[]>>> {
  const dir = new URL("../../migrations/", import.meta.url);
  const files = [...Deno.readDirSync(dir)].filter((f) => f.isFile && f.name.endsWith(".sql")).map((f) => f.name).sort();
  const out = new Map<string, Map<string, Param[]>>();
  for (const file of files) {
    const sql = await Deno.readTextFile(new URL(file, dir));
    const re = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi;
    for (let m = re.exec(sql); m; m = re.exec(sql)) {
      const params = parseParams(balanced(sql, m.index + m[0].length - 1, "(", ")"));
      const key = params.map((p) => p.name).join(",");
      const name = m[1]!.toLowerCase();
      if (!out.has(name)) out.set(name, new Map());
      out.get(name)!.set(key, params);
    }
  }
  return out;
}

type Call = { file: string; name: string; keys: string[] };

async function rpcCalls(file: string): Promise<Call[]> {
  const source = await Deno.readTextFile(new URL(`../${file}`, import.meta.url));
  const calls: Call[] = [];
  const re = /\brpc(?:<[^()]*?>)?\(\s*"([a-z0-9_]+)"\s*,\s*\{/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const body = balanced(source, m.index + m[0].length - 1, "{", "}");
    const keys = [...body.matchAll(/(?:^|[,{\s])(p_[a-z0-9_]+)\s*:/g)].map((k) => k[1]!);
    calls.push({ file, name: m[1]!, keys });
  }
  return calls;
}

const FILES = [
  "automation-worker/index.ts", "ai-worker/index.ts", "ai-playground/index.ts", "instagram-worker/index.ts",
  "tests/serve-automation-e2e.ts", "tests/serve-ai-e2e.ts", "_shared/meta-repository.ts",
];

Deno.test("rpc argument names match the latest SQL signatures", async () => {
  const signatures = await sqlSignatures();
  const problems: string[] = [];
  let checked = 0;
  for (const file of FILES) {
    for (const call of await rpcCalls(file)) {
      checked++;
      const overloads = signatures.get(call.name);
      if (!overloads) { problems.push(`${call.file}: public.${call.name} not found`); continue; }
      const fits = [...overloads.values()].some((params) =>
        call.keys.every((k) => params.some((p) => p.name === k))
        && params.every((p) => p.hasDefault || call.keys.includes(p.name)));
      if (!fits) problems.push(`${call.file}: ${call.name}(${call.keys.join(", ")}) vs ${[...overloads.keys()].map((k) => `(${k})`).join(" | ")}`);
    }
  }
  assert(checked >= 30, `expected to inspect the worker rpc calls, saw ${checked}`);
  assert(problems.length === 0, problems.join("\n"));
});

Deno.test("contract parser reads overloads, defaults and OUT params", () => {
  const params = parseParams("p_a uuid, p_b extensions.vector(1536), p_c int default 5, out x text");
  assert(JSON.stringify(params) === JSON.stringify([
    { name: "p_a", hasDefault: false }, { name: "p_b", hasDefault: false }, { name: "p_c", hasDefault: true },
  ]));
});
