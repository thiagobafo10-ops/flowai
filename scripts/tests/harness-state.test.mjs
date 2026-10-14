import assert from "node:assert/strict";
import test from "node:test";
import { MARKER_NAME, recoverStaleRun, restoreStates, vaultMarkerStore } from "../lib/harness-state.mjs";

// No database: fake `sql` functions and an in-memory marker store.
const memoryStore = (initial = null) => {
  let value = initial;
  return { read: () => value, write: (state) => { value = state; }, clear: () => { value = null; }, get value() { return value; } };
};
const states = { automation: { active: true, config: null }, instagram: { active: false, config: { baseUrl: "http://x", serviceKey: "k", workerSecret: "s" } } };

test("no marker: nothing to recover", () => {
  const store = memoryStore();
  assert.deepEqual(recoverStaleRun({ store, restore: () => assert.fail("must not restore"), isAlive: () => false }), { recovered: false, kinds: [] });
});

test("marker from a hard-killed run is restored and then cleared", () => {
  const store = memoryStore({ pid: 999_999, startedAt: Date.now() - 60_000, suite: "automation", states });
  let restored;
  const result = recoverStaleRun({ store, restore: (s) => { restored = s; return []; }, isAlive: () => false });
  assert.deepEqual(result, { recovered: true, kinds: ["automation", "instagram"] });
  assert.deepEqual(restored, states);
  assert.equal(store.value, null);
});

test("marker of a live run refuses to start without touching state", () => {
  const store = memoryStore({ pid: 1234, startedAt: Date.now(), suite: "instagram", states });
  assert.throws(() => recoverStaleRun({ store, restore: () => assert.fail("must not restore"), isAlive: (pid) => pid === 1234 }), /em andamento/);
  assert.ok(store.value, "marker kept");
});

test("an old marker is stale even if its PID was reused", () => {
  const store = memoryStore({ pid: 1234, startedAt: Date.now() - 7 * 3_600_000, suite: "automation", states });
  assert.equal(recoverStaleRun({ store, restore: () => [], isAlive: () => true }).recovered, true);
  assert.equal(store.value, null);
});

test("failed recovery keeps the marker and refuses to start", () => {
  const store = memoryStore({ pid: 1, startedAt: Date.now(), suite: "automation", states });
  assert.throws(() => recoverStaleRun({ store, restore: () => ["automation"], isAlive: () => false }), /automation/);
  assert.ok(store.value, "marker kept for the next attempt");
});

test("restoreStates reports kinds whose readback does not match", () => {
  const statements = [];
  const sql = (statement) => {
    statements.push(statement);
    // Readback: no config for any kind and every cron active.
    return statement.startsWith("select active") ? "t" : "";
  };
  // instagram should come back configured and inactive; the fake returns no config and active=t.
  assert.deepEqual(restoreStates(sql, states), ["instagram"]);
  assert.ok(statements.some((s) => s.includes("public.configure_instagram_worker('http://x','k','s')")));
  assert.ok(statements.some((s) => s.includes("delete from private.automation_worker_config")));
});

test("vault marker store round-trips JSON with quotes safely", () => {
  const statements = [];
  let stored = "";
  const sql = (statement) => {
    statements.push(statement);
    if (statement.includes("vault.create_secret")) stored = JSON.stringify({ suite: "it's" });
    return statement.includes("decrypted_secret") ? stored : "";
  };
  const store = vaultMarkerStore(sql);
  assert.equal(store.read(), null);
  store.write({ suite: "it's" });
  assert.ok(statements.at(-1).includes(`'${MARKER_NAME}'`), "named marker secret");
  assert.ok(statements.some((s) => s.includes("vault.create_secret('{\"suite\":\"it''s\"}'")), "apostrophe escaped");
  assert.deepEqual(store.read(), { suite: "it's" });
  store.clear();
  assert.ok(statements.at(-1).startsWith("delete from vault.secrets"));
});
