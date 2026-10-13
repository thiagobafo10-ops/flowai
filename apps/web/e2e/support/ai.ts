import { psql } from "./local-db";

export const AI_TEST_URL = "http://127.0.0.1:54327";

/** Runs one ai-worker pass (processes tasks whose debounce has elapsed). */
export async function runAiWorker(): Promise<void> {
  const response = await fetch(`${AI_TEST_URL}/__test__/run-ai-worker`, { method: "POST" });
  if (!response.ok) throw new Error(`AI worker fixture failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
}
export async function openAiCalls(): Promise<{ path: string }[]> {
  const response = await fetch(`${AI_TEST_URL}/__test__/openai-calls`);
  if (!response.ok) throw new Error(`OpenAI calls fixture failed: ${response.status}`);
  return response.json();
}
export async function chatCompletionCount(): Promise<number> {
  return (await openAiCalls()).filter((call) => call.path === "/chat/completions").length;
}

const orgOf = (email: string) => `(select ms.organization_id from public.memberships ms join auth.users u on u.id = ms.user_id where u.email = '${email}' limit 1)`;
function assertEmail(email: string) { if (!/^[\w.+@-]+$/.test(email)) throw new Error("e-mail inválido para helper"); }

/** Job states of the org's AI queue, e.g. ["reply:cancelled", "index_document:done"]. */
export function aiJobStates(email: string): string[] {
  assertEmail(email);
  return psql(`select kind || ':' || state from public.ai_jobs where organization_id = ${orgOf(email)} order by created_at`).split("\n").filter(Boolean);
}
export function aiMessageCount(email: string): number {
  assertEmail(email);
  return Number(psql(`select count(*) from public.messages where sender_type = 'ai' and organization_id = ${orgOf(email)}`));
}

/**
 * Runs the worker until no pending/running job is left for the org. A job still inside
 * its 4 s debounce (run_after in the future) stays pending, so the loop simply retries;
 * readiness comes from the database, not from the host clock.
 */
export async function drainAiJobs(email: string, timeoutMs = 40_000): Promise<void> {
  assertEmail(email);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await runAiWorker();
    const open = Number(psql(`select count(*) from public.ai_jobs where organization_id = ${orgOf(email)} and state in ('pending','running')`));
    if (open === 0) return;
    if (Date.now() > deadline) throw new Error(`AI jobs still open after ${timeoutMs} ms: ${aiJobStates(email).join(",")}`);
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
}
