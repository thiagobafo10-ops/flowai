import { expect, test } from "vitest";
import { buildRunViews, handleLabel } from "./runs";

const REFS = { tags: [{ id: "tag1", name: "vip" }], stages: [], members: [], channels: [] };
const MSG = "00000000-0000-4000-8000-0000000000a1";
const TAG = "00000000-0000-4000-8000-0000000000a2";
const GRAPH = {
  nodes: [
    { id: MSG, type: "message", config: { mode: "text", text: "Escolha", quickReplies: [{ id: "q1", title: "Quero" }] }, position: { x: 0, y: 0 } },
    { id: TAG, type: "tag", config: { tagId: "tag1" }, position: { x: 0, y: 0 } },
  ],
  edges: [],
};

const run = (over: Record<string, unknown> = {}) => ({
  id: "r1", status: "completed", version: 1, error: null, created_at: "2026-10-13T10:00:00Z", updated_at: "2026-10-13T10:05:00Z",
  contacts: { name: "Maria", phone: null, email: null }, ...over,
});

test("runs map contact, start/end and steps with node summary, handle, result and time", () => {
  const steps = [
    { id: "s2", run_id: "r1", node_id: TAG, iteration: 0, status: "completed", handle: "default", output: { result: null }, error: null, created_at: "2026-10-13T10:02:00Z" },
    { id: "s1", run_id: "r1", node_id: MSG, iteration: 0, status: "completed", handle: "opt:q1", output: { result: "sent" }, error: null, created_at: "2026-10-13T10:01:00Z" },
    { id: "x", run_id: "other", node_id: MSG, iteration: 0, status: "completed", handle: null, output: null, error: null, created_at: "2026-10-13T10:00:00Z" },
  ];
  const [view] = buildRunViews([run()], steps, new Map([[1, GRAPH]]), REFS);
  expect(view).toEqual({
    id: "r1", status: "completed", contactName: "Maria", startedAt: "2026-10-13T10:00:00Z", endedAt: "2026-10-13T10:05:00Z", error: null,
    steps: [
      { id: "s1", nodeId: MSG, nodeLabel: "Mensagem", nodeSummary: "Escolha", handle: "Quero", status: "completed", result: "sent", at: "2026-10-13T10:01:00Z" },
      { id: "s2", nodeId: TAG, nodeLabel: "Adicionar etiqueta", nodeSummary: "vip", handle: "Padrão", status: "completed", result: null, at: "2026-10-13T10:02:00Z" },
    ],
  });
});

test("active runs have no end; missing contact, node or version are labelled; error code is the step result", () => {
  const steps = [{ id: "s1", run_id: "r1", node_id: "00000000-0000-4000-8000-0000000000ff", iteration: 0, status: "failed", handle: null, output: null, error: "webhook_failed", created_at: "2026-10-13T10:01:00Z" }];
  const [waiting] = buildRunViews([run({ status: "waiting", contacts: null })], [], new Map([[1, GRAPH]]), REFS);
  expect(waiting.endedAt).toBeNull();
  expect(waiting.contactName).toBeNull();
  const [failed] = buildRunViews([run({ status: "failed", error: "webhook_failed", version: 2 })], steps, new Map(), REFS);
  expect(failed.error).toBe("webhook_failed");
  expect(failed.steps[0]).toMatchObject({ nodeLabel: "Bloco removido", nodeSummary: "", handle: null, result: "webhook_failed" });
});

test("handle labels", () => {
  expect(handleLabel(null, undefined)).toBeNull();
  expect(handleLabel("true", undefined)).toBe("Sim");
  expect(handleLabel("false", undefined)).toBe("Não");
  expect(handleLabel("no_reply", undefined)).toBe("Sem resposta");
  expect(handleLabel("sent", undefined)).toBe("Enviada");
  expect(handleLabel("handoff", undefined)).toBe("Transferência");
  expect(handleLabel("opt:zz", undefined)).toBe("Opção zz");
  expect(handleLabel("weird", undefined)).toBe("weird");
});
