// Worker cron/config state the E2E harness pauses, plus a crash-recovery marker.
// The marker lives in the local Vault (encrypted, like the worker secrets it holds) and is
// written before any mutation, so a hard-killed run (no finally) is restored by the next run.
export const MARKER_NAME = "flowai_e2e_harness_state";
const STALE_AFTER_MS = 6 * 3_600_000; // longer than any suite; guards against PID reuse.

export const quote = (text) => "'" + String(text).replaceAll("'", "''") + "'";

export function readConfig(sql, kind) {
  const value = sql(`select json_build_object('baseUrl',c.base_url,'serviceKey',s.decrypted_secret,'workerSecret',w.decrypted_secret) from private.${kind}_worker_config c join vault.decrypted_secrets s on s.id=c.service_key_secret_id join vault.decrypted_secrets w on w.id=c.worker_secret_id;`);
  return value ? JSON.parse(value) : null;
}

export function captureStates(sql, kinds) {
  const states = {};
  for (const kind of kinds) {
    const active = sql(`select active from cron.job where jobname='flowai-${kind}-worker';`);
    states[kind] = { active: active ? active === "t" : null, config: readConfig(sql, kind) };
  }
  return states;
}

/** Restores Vault/config before re-enabling crons; returns the kinds that failed verification. */
export function restoreStates(sql, states) {
  const failed = [];
  for (const [kind, state] of Object.entries(states)) {
    try {
      if (state.config) sql(`select public.configure_${kind}_worker(${quote(state.config.baseUrl)},${quote(state.config.serviceKey)},${quote(state.config.workerSecret)});`);
      else sql(`with removed as (delete from private.${kind}_worker_config returning service_key_secret_id,worker_secret_id) delete from vault.secrets where id in (select service_key_secret_id from removed union all select worker_secret_id from removed);`);
      if (state.active !== null) sql(`select cron.alter_job(jobid,active:=${state.active}) from cron.job where jobname='flowai-${kind}-worker';`);
      if (JSON.stringify(readConfig(sql, kind)) !== JSON.stringify(state.config)) throw new Error("config mismatch");
      if (state.active !== null && sql(`select active from cron.job where jobname='flowai-${kind}-worker';`) !== (state.active ? "t" : "f")) throw new Error("cron mismatch");
    } catch {
      failed.push(kind);
    }
  }
  return failed;
}

export function vaultMarkerStore(sql) {
  return {
    read() {
      const value = sql(`select decrypted_secret from vault.decrypted_secrets where name='${MARKER_NAME}';`);
      return value ? JSON.parse(value) : null;
    },
    write(state) {
      sql(`delete from vault.secrets where name='${MARKER_NAME}';`);
      sql(`select vault.create_secret(${quote(JSON.stringify(state))},'${MARKER_NAME}');`);
    },
    clear() { sql(`delete from vault.secrets where name='${MARKER_NAME}';`); },
  };
}

/**
 * Restores the state left by a run that died without its finally. Refuses (throws) when the
 * marker belongs to a live run or when restoration fails; the marker is then kept.
 */
export function recoverStaleRun({ store, restore, isAlive, now = Date.now() }) {
  const marker = store.read();
  if (!marker) return { recovered: false, kinds: [] };
  const recent = now - Number(marker.startedAt ?? 0) < STALE_AFTER_MS;
  if (recent && marker.pid !== process.pid && isAlive(marker.pid)) {
    throw new Error(`Outra execução do harness E2E (${marker.suite}, PID ${marker.pid}) está em andamento.`);
  }
  const failed = restore(marker.states ?? {});
  if (failed.length) throw new Error(`Falha ao recuperar estado de execução interrompida: ${failed.join(", ")}; confira o banco local.`);
  store.clear();
  return { recovered: true, kinds: Object.keys(marker.states ?? {}) };
}

export const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
};
