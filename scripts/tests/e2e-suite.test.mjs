import assert from "node:assert/strict";
import test from "node:test";
import { mvpWebServerCommand, selectE2eSuite } from "../lib/e2e-suite.mjs";
import { captureStates, restoreStates } from "../lib/harness-state.mjs";

test("AI selects its fake OpenAI proxy and owns every shared worker state", () => {
  const suite = selectE2eSuite("ai");
  assert.equal(suite.port, 54327);
  assert.equal(suite.webPort, 3102);
  assert.equal(suite.config, "playwright.ai.config.ts");
  assert.equal(suite.proxy, "serve-ai-e2e.ts");
  assert.equal(suite.ready, "openai-calls");
  assert.deepEqual(suite.workerKinds, ["automation", "ai", "instagram"]);
  assert.equal(selectE2eSuite().port, 54328);
  assert.equal(selectE2eSuite("instagram").port, 54326);
  assert.equal(selectE2eSuite("mvp").proxy, suite.proxy);
  assert.equal(selectE2eSuite("mvp").config, "playwright.mvp.config.ts");
  assert.deepEqual(selectE2eSuite("mvp").workerKinds, suite.workerKinds);
  assert.throws(() => selectE2eSuite("https://provider.example"), /desconhecida/);
});

test("MVP build reuse is explicit and rejects a different public proxy", () => {
  assert.equal(mvpWebServerCommand(false, 54327), "npm run build && npx next start -p 3102");
  assert.equal(mvpWebServerCommand(true, 54327), "npx next start -p 3102");
  assert.throws(() => mvpWebServerCommand(true, 54328), /54327/);
});

for (const config of [null, { baseUrl: "http://local-original", serviceKey: "original-key", workerSecret: "original-secret" }]) {
  test(`AI run restores ${config ? "configured" : "unconfigured"} worker and cron after fixture changes`, () => {
    const original = { automation: { active: null, config: null }, ai: { active: false, config }, instagram: { active: true, config: null } };
    const db = structuredClone(original);
    // In-memory SQL boundary: exercise the real capture/restore algorithm, no Docker/keys.
    const sql = (statement) => {
      const kind = /(?:private\.|configure_|flowai-)(automation|ai|instagram)/.exec(statement)?.[1];
      assert.ok(kind, "SQL stays within known worker state");
      if (statement.startsWith("select active")) return db[kind].active === null ? "" : db[kind].active ? "t" : "f";
      if (statement.startsWith("select json_build_object")) return db[kind].config ? JSON.stringify(db[kind].config) : "";
      if (statement.includes("configure_")) {
        const values = [...statement.matchAll(/'([^']*)'/g)].map((match) => match[1]);
        db[kind].config = { baseUrl: values[0], serviceKey: values[1], workerSecret: values[2] };
      } else if (statement.startsWith("with removed")) db[kind].config = null;
      else if (statement.startsWith("select cron.alter_job")) db[kind].active = statement.includes("active:=true");
      else assert.fail("unexpected mutation");
      return "";
    };
    const saved = captureStates(sql, selectE2eSuite("ai").workerKinds);
    for (const state of Object.values(db)) {
      if (state.active !== null) state.active = false;
      state.config = { baseUrl: "http://fixture", serviceKey: "fixture-key", workerSecret: "fixture-secret" };
    }
    assert.deepEqual(restoreStates(sql, saved), []);
    assert.deepEqual(db, original);
  });
}
