import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import type { AutomationGraph, TriggerType } from "@flowai/core";
import { psql } from "./local-db";
import { gotoReady } from "./nav";

export const AUTOMATION_TEST_URL = process.env.FLOWAI_E2E_PROXY_URL ?? "http://127.0.0.1:54328";
export function orgFor(email: string): string {
  if (!/^[\w.+@-]+$/.test(email)) throw new Error("Invalid fixture email");
  return psql(`select organization_id from public.memberships m join auth.users u on u.id=m.user_id where u.email='${email}' limit 1`);
}
export async function runAutomationWorker() {
  const response = await fetch(`${AUTOMATION_TEST_URL}/__test__/run-automation-worker`, { method: "POST" });
  if (!response.ok) throw new Error(`Automation fixture worker failed: ${response.status}`);
}
/** Drain from database state, including overdue waits, rather than fixed sleeps. */
export async function drainAutomationRuns(email: string, instagram = false) {
  const org = orgFor(email);
  for (let attempt = 0; attempt < 30; attempt++) {
    if (instagram) {
      const response = await fetch(`${AUTOMATION_TEST_URL}/__test__/run-worker`, { method: "POST" });
      if (!response.ok) throw new Error("Instagram fixture worker failed");
    }
    await runAutomationWorker();
    const pending = Number(psql(`select count(*) from public.automation_runs where organization_id='${org}' and (status in ('pending','running') or (status='waiting' and resume_at<=now()))`));
    const work = instagram ? Number(psql(`select count(*) from pgmq.q_instagram_work q join public.instagram_events e on e.id=(q.message->>'eventId')::uuid where e.organization_id='${org}'`)) : 0;
    if (pending === 0 && work === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local automation queue did not drain");
}

export async function drainGrowth(email: string) {
  const org = orgFor(email);
  try {
    psql(`select private.start_due_campaigns();`);
  } catch {
    // ignora se não houver campanhas no ponto
  }
  for (let attempt = 0; attempt < 30; attempt++) {
    await runAutomationWorker();
    const pendingRuns = Number(
      psql(
        `select count(*) from public.automation_runs where organization_id='${org}' and (status in ('pending','running') or (status='waiting' and resume_at<=now()))`,
      ),
    );
    const pendingDeliveries = Number(
      psql(
        `select count(*) from public.outreach_deliveries where organization_id='${org}' and status in ('pending','sending') and run_after<=now()`,
      ),
    );
    if (pendingRuns === 0 && pendingDeliveries === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
export async function createTemplate(page: Page, name: string) {
  await gotoReady(page, "/automacoes");
  await page.getByRole("button", { name: "Nova automação", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.getByLabel("Nome da automação")).toHaveValue(name);
  return page.url().split("/").at(-1)!;
}
export async function selectNode(page: Page, type: string, index = 0) {
  const response = await page.request.get(`/api/automacoes/${page.url().split("/").at(-1)}`);
  const detail = await response.json();
  const node = detail.graph.nodes.filter((item: { type: string }) => item.type === type)[index];
  if (!node) throw new Error(`Missing fixture node ${type}`);
  const card = page.locator(`.react-flow__node[data-id="${node.id}"]`);
  await card.click();
}
export async function activate(page: Page) {
  await expect(page.getByRole("button", { name: "Ativar", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.locator("header").getByText("Ativa", { exact: true })).toBeVisible();
}
export async function authorComment(page: Page, keyword: string, text: string, media = "") {
  const id = await createTemplate(page, "Boas-vindas no Direct");
  await selectNode(page, "trigger");
  await page.getByLabel("Quando", { exact: true }).selectOption("instagram_comment");
  await page.getByLabel("Palavras-chave", { exact: true }).fill(keyword);
  await page.getByLabel("ID da publicação (opcional)").fill(media);
  await selectNode(page, "message");
  await page.getByLabel("Mensagem", { exact: true }).fill(text);
  await activate(page);
  return id;
}
/** Fixture authoring uses the same RPC/auth contract; execution stays real. */
export function createDelayFlow(email: string): string {
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const graph: AutomationGraph = {
    nodes: [
      { id: ids[0], type: "trigger", config: {}, position: { x: 0, y: 0 } },
      { id: ids[1], type: "delay", config: { minutes: 1 }, position: { x: 0, y: 140 } },
      { id: ids[2], type: "message", config: { mode: "text", text: "Espera concluída", replyTimeoutHours: 24 }, position: { x: 0, y: 280 } },
      { id: ids[3], type: "end", config: {}, position: { x: 0, y: 420 } },
    ],
    edges: ids.slice(0, 3).map((id, i) => ({ id: randomUUID(), source: id, target: ids[i + 1], sourceHandle: "default" })),
  };
  return saveFixture(email, "Espera E2E", "message_received", { firstMessageOnly: false }, graph);
}
// Dollar-quoted literal with a random tag: apostrophes in names/text cannot break the SQL.
function literal(text: string): string {
  const tag = `$v${randomUUID().replaceAll("-", "")}$`;
  if (text.includes(tag) || text.includes("$fixture$")) throw new Error("Invalid fixture literal");
  return `${tag}${text}${tag}`;
}
function saveFixture(email: string, name: string, trigger: TriggerType, config: unknown, graph: AutomationGraph) {
  const org = orgFor(email);
  return psql(`do $fixture$ declare v_id uuid; begin
perform set_config('request.jwt.claim.sub',(select id::text from auth.users where email=${literal(email)}),true);
v_id:=public.save_automation(${literal(org)},null,${literal(name)},${literal(trigger)},${literal(JSON.stringify(config))},${literal(JSON.stringify(graph))});
perform public.activate_automation(v_id); perform set_config('flowai.e2e.id',v_id::text,false);
end $fixture$; select current_setting('flowai.e2e.id');`).split("\n").at(-1)!;
}
