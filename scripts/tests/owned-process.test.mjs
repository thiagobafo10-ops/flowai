import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { createCancellation, installCancellation, stopOwnedTree } from "../lib/owned-process.mjs";
import { EventEmitter } from "node:events";

// Lightweight: only tiny Node processes, no browsers, Next, Deno or database.
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pid, ms = 3_000) {
  for (const start = Date.now(); Date.now() - start < ms; await delay(50)) if (!isAlive(pid)) return true;
  return !isAlive(pid);
}
const sleeper = () => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
// Parent that owns a grandchild (like Playwright owning Next/browsers) and reports its PID.
async function treeRoot() {
  const code = `const { spawn } = require("node:child_process");
const g = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
console.log(g.pid); setInterval(() => {}, 1000);`;
  const root = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "ignore"], detached: process.platform !== "win32" });
  const [line] = await once(root.stdout, "data");
  return { root, grandchild: Number(String(line).trim()) };
}

test("stopOwnedTree kills the whole owned tree and spares unrelated processes", async () => {
  const unrelated = sleeper();
  const { root, grandchild } = await treeRoot();
  try {
    assert.ok(isAlive(grandchild));
    const started = Date.now();
    assert.equal(await stopOwnedTree(root, { graceMs: 200, forceMs: 5_000 }), true);
    assert.ok(Date.now() - started < 6_000, "bounded");
    assert.ok(await gone(root.pid), "root stopped");
    assert.ok(await gone(grandchild), "grandchild stopped");
    assert.ok(isAlive(unrelated.pid), "unrelated process preserved");
  } finally {
    unrelated.kill();
    if (isAlive(grandchild)) process.kill(grandchild);
  }
});

test("stopOwnedTree waits for a child that shuts down by itself within the grace period", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 300)"], { stdio: "ignore" });
  const started = Date.now();
  assert.equal(await stopOwnedTree(child, { signal: "SIGINT", graceMs: 5_000 }), true);
  assert.ok(Date.now() - started < 4_000, "returned on exit, not on timeout");
  assert.equal(await stopOwnedTree(child), true, "idempotent on an exited child");
});

test("first signal fixes the exit code; children stop before restore, which runs once", async () => {
  const { root, grandchild } = await treeRoot();
  const events = []; const exits = [];
  const cancellation = createCancellation({
    children: () => [root, undefined],
    restore: () => events.push(`restore:root-exited=${root.exitCode !== null || root.signalCode !== null}`),
    exit: (code) => exits.push(code),
    graceMs: 200,
  });
  const signals = new EventEmitter();
  installCancellation(cancellation, signals);
  signals.emit("SIGINT");
  signals.emit("SIGTERM");
  await cancellation.shutdown();
  await delay(20);
  cancellation.onExit();
  assert.deepEqual(events, ["restore:root-exited=true"]);
  assert.deepEqual(exits, [130, 130]);
  assert.ok(await gone(grandchild), "owned grandchild stopped");
});

test("SIGTERM maps to 143 and an unexpected exit restores synchronously", async () => {
  const exits = []; let restores = 0;
  const viaSignal = createCancellation({ children: () => [], restore: () => restores++, exit: (code) => exits.push(code) });
  await viaSignal.onSignal("SIGTERM");
  assert.deepEqual(exits, [143]);
  const child = sleeper();
  const viaExit = createCancellation({ children: () => [{ child, graceMs: 0 }], restore: () => restores++ });
  viaExit.onExit();
  viaExit.onExit();
  assert.equal(restores, 2, "one restore per coordinator");
  const notSpawned = createCancellation({ children: () => [undefined, { child: undefined, graceMs: 2_000 }], restore: () => restores++ });
  const started = Date.now();
  await notSpawned.shutdown();
  assert.ok(Date.now() - started < 1_000, "slots not yet spawned are skipped without waiting");
  assert.equal(restores, 3);
  assert.ok(await gone(child.pid), "owned child force-killed on exit");
});
