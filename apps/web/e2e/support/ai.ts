export const AI_TEST_URL = "http://127.0.0.1:54327";

/** Runs one ai-worker pass (processes tasks whose debounce has elapsed). */
export async function runAiWorker(): Promise<void> {
  const response = await fetch(`${AI_TEST_URL}/__test__/run-ai-worker`, { method: "POST" });
  if (!response.ok) throw new Error("AI worker fixture failed");
}
export async function openAiCalls(): Promise<{ path: string }[]> {
  const response = await fetch(`${AI_TEST_URL}/__test__/openai-calls`);
  return response.json();
}
/** The reply task waits 4 s so bursts of messages are grouped. */
export const DEBOUNCE_MS = 4500;
