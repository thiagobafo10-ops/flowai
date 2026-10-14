import { expect, test } from "vitest";
import { STEPS_LIMIT, buildRunViews, buildStepViews, handleLabel, loadRunSteps } from "./runs";

const REFS = { tags: [{ id: "tag1", name: "vip" }], stages: [], members: [], channels: [] };
const TRIGGER = "00000000-0000-4000-8000-0000000000a0";
const MSG = "00000000-0000-4000-8000-0000000000a1";
const TAG = "00000000-0000-4000-8000-0000000000a2";
const GRAPH = {
  nodes: [
    { id: TRIGGER, type: "trigger", config: {}, position: { x: 0, y: 0 } },
    { id: MSG, type: "message", config: { mode: "text", text: "Escolha", quickReplies: [{ id: "q1", title: "Quero" }] }, position: { x: 0, y: 0 } },
    { id: TAG, type: "tag", config: { tagId: "tag1" }, position: { x: 0, y: 0 } },
  ],
  edges: [],
};

const run = (over: Record<string, unknown> = {}) => ({
  id: "r1", status: "completed", version: 1, error: null, created_at: "2026-10-13T10:00:00Z", updated_at: "2026-10-13T10:05:00Z",
  contacts: { name: "Maria", phone: null, email: null }, ...over,
});
const step = (id: string, node: string, iteration: number, at: string, over: Record<string, unknown> = {}) => ({
  id, run_id: "r1", node_id: node, iteration, status: "completed", handle: null, output: null, error: null, created_at: at, ...over,
});

test("runs map contact and start/end; active runs have no end", () => {
  expect(buildRunViews([run()])).toEqual([
    { id: "r1", status: "completed", contactName: "Maria", startedAt: "2026-10-13T10:00:00Z", endedAt: "2026-10-13T10:05:00Z", error: null },
  ]);
  const [waiting] = buildRunViews([run({ status: "waiting", contacts: null })]);
  expect(waiting).toMatchObject({ endedAt: null, contactName: null });
});

test("steps show summary, handle, result and time; newest iteration first; trigger and removed nodes are not rerunnable", () => {
  const steps = [
    step("s1", TRIGGER, 0, "2026-10-13T10:00:00Z"),
    step("s2", MSG, 0, "2026-10-13T10:01:00Z", { handle: "opt:q1", output: { result: "sent" } }),
    step("s4", TAG, 1, "2026-10-13T10:09:00Z", { handle: "default" }),
    step("s3", "00000000-0000-4000-8000-0000000000ff", 0, "2026-10-13T10:02:00Z", { status: "failed", error: "webhook_failed" }),
  ];
  const views = buildStepViews(steps, GRAPH, REFS);
  expect(views.map((s) => s.id)).toEqual(["s4", "s1", "s2", "s3"]);
  expect(views[0]).toEqual({ id: "s4", nodeId: TAG, nodeLabel: "Adicionar etiqueta", nodeSummary: "vip", handle: "Padrão", status: "completed", result: null, at: "2026-10-13T10:09:00Z", iteration: 1, rerunnable: true });
  expect(views[1]).toMatchObject({ nodeLabel: "Gatilho", rerunnable: false });
  expect(views[2]).toMatchObject({ nodeLabel: "Mensagem", nodeSummary: "Escolha", handle: "Quero", result: "sent", rerunnable: true });
  expect(views[3]).toMatchObject({ nodeLabel: "Bloco removido", nodeSummary: "", result: "webhook_failed", rerunnable: false });
});

test("handle labels", () => {
  expect(handleLabel(null, undefined)).toBeNull();
  expect(handleLabel("true", undefined)).toBe("Sim");
  expect(handleLabel("false", undefined)).toBe("Não");
  expect(handleLabel("no_reply", undefined)).toBe("Sem resposta");
  expect(handleLabel("sent", undefined)).toBe("Enviada");
  expect(handleLabel("handoff", undefined)).toBe("Transferência");
  expect(handleLabel("opt:zz", undefined)).toBe("Opção zz");
  expect(handleLabel("constructor", undefined)).toBe("constructor");
});

function fakeSupabase(tables: Record<string, unknown[]>, calls: { table: string; limit?: number; orders: string[] }[]) {
  return {
    from: (table: string) => {
      const call: { table: string; limit?: number; orders: string[] } = { table, orders: [] };
      calls.push(call);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) b[m] = () => b;
      b.order = (column: string, opts?: { ascending?: boolean }) => { call.orders.push(`${column}:${opts?.ascending === false ? "desc" : "asc"}`); return b; };
      b.limit = (n: number) => { call.limit = n; return b; };
      b.maybeSingle = async () => ({ data: tables[table]?.[0] ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: (tables[table] ?? []).slice(0, call.limit ?? Infinity), error: null });
      return b;
    },
  } as never;
}

test("loadRunSteps caps the steps (newest first) and flags the cap", async () => {
  const many = Array.from({ length: STEPS_LIMIT + 5 }, (_, i) => step(`s${i}`, TAG, 0, new Date(Date.UTC(2026, 9, 13, 0, 0, i)).toISOString()));
  const calls: { table: string; limit?: number; orders: string[] }[] = [];
  const result = await loadRunSteps(fakeSupabase({ automation_runs: [{ id: "r1", version: 1 }], automation_run_steps: many, automation_versions: [{ graph: GRAPH }] }, calls), "org", "auto", "r1", REFS);
  expect(result?.capped).toBe(true);
  expect(result?.steps).toHaveLength(STEPS_LIMIT);
  const stepsCall = calls.find((c) => c.table === "automation_run_steps");
  expect(stepsCall?.limit).toBe(STEPS_LIMIT + 1);
  expect(stepsCall?.orders.slice(0, 2)).toEqual(["iteration:desc", "created_at:desc"]);
});

test("loadRunSteps returns null for an unknown run and is uncapped for short runs", async () => {
  expect(await loadRunSteps(fakeSupabase({}, []), "org", "auto", "r1", REFS)).toBeNull();
  const result = await loadRunSteps(fakeSupabase({ automation_runs: [{ id: "r1", version: 1 }], automation_run_steps: [step("s1", TAG, 0, "2026-10-13T10:00:00Z")], automation_versions: [{ graph: GRAPH }] }, []), "org", "auto", "r1", REFS);
  expect(result).toMatchObject({ capped: false, steps: [{ id: "s1" }] });
});
