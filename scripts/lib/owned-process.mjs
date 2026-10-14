import { spawnSync } from "node:child_process";

// Stops only process trees this harness spawned and coordinates one-time restoration on cancel.
const alive = (child) => Boolean(child?.pid) && child.exitCode === null && child.signalCode === null;
// Entries are ChildProcess instances or { child, graceMs }; not-yet-spawned slots are undefined.
const ownedChild = (entry) => (entry && Object.hasOwn(entry, "child") ? entry.child : entry);

function waitForExit(child, ms) {
  if (!alive(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { child.off("exit", done); resolve(false); }, ms);
    function done() { clearTimeout(timer); resolve(true); }
    child.once("exit", done);
  });
}

/** Forcefully kills the tree rooted at a PID this script spawned (never anything else). */
export function killOwnedTreeSync(child, platform = process.platform) {
  if (!alive(child) || !child.pid) return;
  if (platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
}

/**
 * Lets the child shut down its own tree (Playwright stops Next and browsers on SIGINT), then
 * force-kills the owned tree after `graceMs`. On Windows a console Ctrl-C already reaches the
 * child, so it is only waited for; on POSIX the signal is forwarded to the child's process group.
 * Resolves to true once the root exited within `graceMs + forceMs`.
 */
export async function stopOwnedTree(child, { signal = "SIGINT", graceMs = 15_000, forceMs = 5_000, platform = process.platform } = {}) {
  if (!alive(child)) return true;
  if (platform !== "win32") {
    try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already gone */ } }
  }
  if (graceMs > 0 && await waitForExit(child, graceMs)) return true;
  killOwnedTreeSync(child, platform);
  return waitForExit(child, forceMs);
}

/**
 * Coordinates cancellation: the first signal fixes the exit code, children are stopped
 * (bounded) and `restore` runs exactly once — also synchronously on an unexpected exit.
 */
export function createCancellation({ children, restore, exit = (code) => process.exit(code), graceMs = 15_000, platform = process.platform }) {
  let stopping; let restored = false; let restoreOk = true; let exitCode;
  // `restore` signals failure by throwing or returning exactly false.
  const restoreOnce = () => {
    if (restored) return restoreOk;
    restored = true;
    try { restoreOk = restore() !== false; } catch { restoreOk = false; }
    return restoreOk;
  };
  /** Never rejects; resolves true only if every owned child stopped and restoration succeeded. */
  async function shutdown({ signal = "SIGINT", grace = graceMs } = {}) {
    if (!stopping) {
      stopping = (async () => {
        let stopped = true;
        try {
          // Entries are children or { child, graceMs } to cap the grace of helpers such as the proxy.
          for (const entry of children()) {
            const child = ownedChild(entry);
            if (!await stopOwnedTree(child, { signal, graceMs: Math.min(grace, entry?.graceMs ?? grace), platform })) stopped = false;
          }
        } catch {
          stopped = false;
        } finally {
          restoreOnce();
        }
        return stopped && restoreOk;
      })();
    }
    return stopping;
  }
  async function onSignal(signal) {
    if (exitCode === undefined) exitCode = signal === "SIGTERM" ? 143 : 130;
    const ok = await shutdown({ signal });
    exit(ok ? exitCode : 1);
  }
  /** Synchronous last resort for an unexpected exit; returns false if restoration failed. */
  function onExit() {
    try { for (const entry of children()) killOwnedTreeSync(ownedChild(entry), platform); } catch { /* still restore */ }
    return restoreOnce();
  }
  return { shutdown, onSignal, onExit, get restored() { return restored; } };
}

/** Installs persistent handlers so a second Ctrl-C cannot bypass restoration. */
export function installCancellation(cancellation, target = process) {
  target.on("SIGINT", () => cancellation.onSignal("SIGINT"));
  target.on("SIGTERM", () => cancellation.onSignal("SIGTERM"));
  target.on("exit", () => { if (!cancellation.onExit()) process.exitCode = 1; });
}
