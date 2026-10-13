# Fase 7A — Automações — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Editor visual de automações com motor persistente que executa fluxos (mensagens com botões/respostas rápidas, IA, condições, esperas e ações de CRM) disparados por mensagens, palavras-chave, comentários e stories do Instagram e eventos de CRM, com prioridade sobre a IA.

**Architecture:** Lógica pura (schemas, validador, motor `executeNode`/`nextNode`, formatação do Instagram) em `packages/core/src/automation`. Banco: versões congeladas do grafo, disparo por triggers SQL na ingestão e em `events`, fila de execuções no padrão das Fases 5/6 (reserva com token, varredura, cron 5 s) e uma função transacional `apply_automation_step` que grava o passo e aplica efeitos de CRM e envio. `automation-worker` (Deno) executa IA e webhook e chama o banco. Editor em React Flow.

**Tech Stack:** Postgres 17 (pgcrypto, pg_cron, pg_net, Vault), Deno 2 Edge Functions, TypeScript + Zod 4, Next.js 16 + React Query + RHF + shadcn/ui + `@xyflow/react`, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-13-fase-7a-automacoes-design.md` (base: MVP §8; Fases 5 e 6).

## Global Constraints

- Docker/Supabase no Bash: `export PATH="/c/Users/thiag/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"`. Deno: `DENO_BIN`/`DENO_DIR` do workspace da Fase 5 (ver README).
- Nunca editar migrations já mergeadas; novas começam em `supabase/migrations/20261013000001_*.sql`.
- Funções: SECURITY DEFINER, `set search_path=''`, nomes qualificados, `revoke all … from public, anon` (e `authenticated` quando só serviço), grants explícitos. Tabelas: RLS, sem policy para `anon`, `revoke truncate, references, trigger`, grants por coluna.
- Nenhum teste chama Meta, OpenAI ou hosts externos reais. Logs e códigos de erro nunca contêm texto de mensagem.
- Limites: mensagem ≤ 1000 bytes UTF-8 no Instagram e ≤ 4096 caracteres no Simulador; até 3 botões **ou** até 13 respostas rápidas; título ≤ 20 caracteres; prazo do clique 1 h a 7 dias (padrão 24 h); espera 1 min a 7 dias; máximo 50 passos por execução.
- Variáveis: `{primeiro_nome}` e `{nome}`; vazias são removidas junto com o espaço excedente.
- Palavras-chave: modos `contains` | `equals` | `starts_with`, sem diferenciar maiúsculas e acentos (NFD + remoção de marcas + minúsculas + espaços colapsados).
- Webhook: só HTTPS; bloqueio de IPs privados, loopback, link-local (IPv4 e IPv6, incluindo mapeados) após resolver DNS; timeout 10 s; resposta ≤ 64 KB; sem seguir redirecionamentos; 3 tentativas com esperas 10 s / 30 s / 90 s.
- Cron do worker: `'5 seconds'`, só chama a Edge Function quando há execuções vencidas; reserva expira em 3 min; lote de 3 por até ~100 s.
- Saídas (handles) de aresta: `default`, `true`, `false`, `no_reply`, `sent`, `handoff`, `opt:<id>` (botão `path` ou resposta rápida).
- Copy pt-BR. Textos fixos: sistema de transferência `Automação transferiu para atendimento humano`; selo `Automação`; Inbox `Em automação: {nome}`, botão `Parar automação`; Canais `As regras de comentário agora são automações.` + link `Gerenciar em Automações`.
- Modelos: `Responder comentário com link`, `Boas-vindas no Direct`, `Qualificar lead com botões`.
- Permissões: admin/owner editam, ativam, pausam, excluem e reexecutam; agent pode `Parar automação`; viewer só lê.

## Review Focus

1. **Cliente manda duas mensagens seguidas enquanto a execução aguarda clique** → a primeira retoma a execução; a segunda não cria execução nova nem tarefa de IA enquanto a execução estiver ativa. Teste no Task 6.
2. **Automação pausada ou excluída com execuções em espera** → pausar: execuções em andamento continuam na versão congelada; excluir: execuções canceladas e `conversations.automation_run_id` limpo, para a IA voltar a atender. Teste no Task 6.
3. **Contato ou conversa excluídos durante a execução** → execução `cancelled` sem erro no worker. Teste no Task 6 (SQL) e Task 9 (worker trata `skip`).
4. **Acentos e maiúsculas em palavras-chave** (`Promoção` casa `promocao`, `PROMOÇÃO!`) e títulos digitados casando botões. Teste no Task 1.
5. **Webhook para host que resolve para IP interno ou redireciona para ele** (`http://`, `https://127.0.0.1`, `https://[::ffff:10.0.0.1]`, DNS → 169.254.x, 302 para 192.168.x) → bloqueado sem request ao alvo. Teste no Task 8.

---

## File Structure

```
packages/core/src/automation/
  schemas.ts      trigger configs, node configs, graph schema, AutomationGraph types
  text.ts         normalizeText, matchKeyword, renderTemplate
  validate.ts     validateGraph
  engine.ts       executeNode, nextNode, resolveReply, evaluateCondition
  instagram.ts    toInstagramMessage (quick_replies / button template)
  templates.ts    automationTemplates
  index.ts        + tests
packages/core/src/channels/instagram/{parse.ts,types.ts,provider.ts}   (modificar: postbacks, quick replies, envio com botões)
supabase/migrations/
  20261013000001_automation_schema.sql      enums, versões, colunas de execução, handles, payload de intents, segredo
  20261013000002_automation_authoring.sql   save/activate/pause/delete/duplicate
  20261013000003_automation_dispatch.sql    disparo, prioridade sobre IA, retomada, cancelamento
  20261013000004_automation_queue.sql       claim/prepare/apply/fail/sweep/dispatch worker/cron/rerun
  20261013000005_instagram_send_payload.sql (Task 9) · 20261013000006_automation_instagram.sql (Task 10) · 20261013000007_automation_simulator_click.sql (Task 13)
supabase/tests/database/039..043_automation_*.test.sql
supabase/functions/
  _shared/safe-webhook.ts
  automation-worker/{handler.ts,index.ts}
  send-message/handler.ts (modificar: payload com botões)
  meta-webhook (modificar só se o parser exigir)
  tests/{safe-webhook,automation-worker}.test.ts, tests/serve-automation-e2e.ts
apps/web/src/
  lib/automation/{actions.ts,queries.ts,messages.ts}(+tests)
  app/api/automacoes/route.ts, app/api/automacoes/[id]/route.ts
  app/(app)/automacoes/page.tsx, app/(app)/automacoes/[id]/page.tsx
  components/automation/{automation-list.tsx,editor.tsx,palette.tsx,node-panel.tsx,nodes/*.tsx,runs.tsx}
  components/inbox/{message-bubble.tsx,conversation-header.tsx}, components/settings/instagram/comment-rules.tsx (modificar)
apps/web/e2e/automation.spec.ts, apps/web/playwright.automation.config.ts, scripts/test-automation-e2e.mjs
docs/superpowers/{fase-7a-pendencias.md}, README.md
```

---

### Task 1: Core — schemas, texto e variáveis

**Files:** Create `packages/core/src/automation/{schemas.ts,text.ts,index.ts,schemas.test.ts,text.test.ts}`; Modify `packages/core/src/index.ts`.

**Interfaces — Produces:**
```ts
type TriggerType = "message_received"|"keyword_detected"|"instagram_comment"|"instagram_story"|"contact_created"|"tag_added"|"stage_changed";
type KeywordMode = "contains"|"equals"|"starts_with";
const triggerConfigSchemas: Record<TriggerType, z.ZodType>;
//  message_received {firstMessageOnly:boolean}; keyword_detected {keywords:string[1..20, each 1..100], mode};
//  instagram_comment {channelId:uuid, mediaId:string|null, keywords, mode}; instagram_story {channelId:uuid};
//  contact_created {}; tag_added {tagId:uuid|null}; stage_changed {stageId:uuid|null}
type NodeType = "trigger"|"message"|"condition"|"delay"|"tag"|"remove_tag"|"assign_user"|"move_stage"|"webhook"|"close_conversation"|"handoff_ai"|"handoff_human"|"end";
const nodeConfigSchemas: Record<NodeType, z.ZodType>;
//  message {mode:"text", text:1..4096, buttons?:{id,title:1..20, kind:"path"|"url", url?:https}[≤3], quickReplies?:{id,title:1..20}[≤13], replyTimeoutHours:1..168 (default 24)}
//        | {mode:"ai"}; buttons and quickReplies mutually exclusive; ids /^[a-z0-9]{1,12}$/ unique in node
//  condition {kind:"keyword", keywords, mode} | {kind:"has_tag", tagId} | {kind:"stage_is", stageId} | {kind:"lead_score_gte", value:0..100}
//            | {kind:"intent_is", intent:1..100} | {kind:"business_hours", days:(1..7)[], start:"HH:MM", end:"HH:MM"}
//  delay {minutes:1..10080}; tag/remove_tag {tagId}; assign_user {userId}; move_stage {stageId}; webhook {url:https}; others {}
type AutomationGraph = { nodes: {id:string; type:NodeType; config:unknown; position:{x:number;y:number}}[]; edges: {id:string; source:string; target:string; sourceHandle:string}[] };
const automationGraphSchema: z.ZodType<AutomationGraph>;   // structural only (ids, types, handles regex)
function normalizeText(s: string): string;
function matchKeyword(text: string, keywords: string[], mode: KeywordMode): boolean;
function renderTemplate(text: string, contact: { name: string | null }): string;
```

- [ ] **Step 1: Failing tests.**
  - `text.test.ts`:
    - `matchKeyword("Quero a PROMOÇÃO!", ["promocao"], "contains")` is true;
    - `equals` ignores surrounding spaces and punctuation-free case: `"  Promoção "` equals `"promocao"` true, `"promoção já"` false;
    - `starts_with` `"Cupom 10"` with `"cupom"` true;
    - empty text is false;
    - `renderTemplate("Oi {primeiro_nome}, tudo bem?", {name:"Ana Souza"})` → `"Oi Ana, tudo bem?"`;
    - with `name:null` → `"Oi, tudo bem?"` (no double space, no dangling space before comma);
    - `{nome}` → full name.
  - `schemas.test.ts`:
    - message with 4 buttons fails;
    - message with both buttons and quickReplies fails;
    - title of 21 characters fails;
    - `url` button with `http://` fails;
    - delay 10081 fails;
    - business_hours `"25:00"` fails;
    - graph edge with handle `opt:ABC` fails (lowercase only), and `opt:a1` passes.
- [ ] **Step 2: Run** `npm test -w packages/core -- src/automation` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS; `npm run typecheck -w packages/core` clean.
- [ ] **Step 5: Commit** `feat(automation): core schemas, keyword matching and templates`.

### Task 2: Core — validador do grafo

**Files:** Create `packages/core/src/automation/{validate.ts,validate.test.ts}`; Modify `index.ts`.

**Interfaces — Produces:**
```ts
type GraphRefs = { tagIds: string[]; stageIds: string[]; userIds: string[]; channelIds: string[] };
type GraphIssue = { nodeId: string | null; code: string; message: string };   // message pt-BR
function validateGraph(graph: AutomationGraph, trigger: { type: TriggerType; config: unknown }, refs: GraphRefs): GraphIssue[];
function requiredHandles(node: AutomationGraph["nodes"][number]): string[];
```
`requiredHandles` returns:
- condition → `true`, `false`;
- message text with path buttons or quick replies → each `opt:<id>` plus `no_reply`;
- message text without them → `default`;
- message ai → `sent`, `handoff`;
- end → none;
- every other type → `default`.

- [ ] **Step 1: Failing tests** (one per rule; each asserts the `code`):
  - `no_trigger`, `multiple_triggers`;
  - `unreachable` (an orphan node);
  - `cycle`;
  - `missing_handle` (condition without `false`; a button without its edge; `no_reply` unconnected);
  - `extra_handle` (an edge from a handle the node does not have);
  - `invalid_config` (with the Zod message);
  - `unknown_tag`, `unknown_stage`, `unknown_user`, `unknown_channel`;
  - `comment_needs_reply`: in an `instagram_comment` automation, the first `message` reached from the trigger must be text with path buttons or quick replies, or its `default` must go to `end`;
  - `message_too_long_instagram`: a text over 1000 bytes in an `instagram_*` automation.

  Valid fixture graphs written in this test file (Task 4 later builds `automationTemplates` from the same shapes) return `[]`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (BFS from trigger; DFS cycle detection). **Step 4: Run** — PASS; typecheck.
- [ ] **Step 5: Commit** `feat(automation): graph validator`.

### Task 3: Core — motor

**Files:** Create `packages/core/src/automation/{engine.ts,engine.test.ts}`; Modify `index.ts`.

**Interfaces — Produces:**
```ts
type RunContext = { contact: { name: string | null; tagIds: string[]; stageId: string | null; leadScore: number | null };
  lastInboundText: string | null; lastIntent: string | null; now: string; timezone: string; channelType: "simulator"|"instagram" };
type Effect =
  | { type: "send_text"; text: string; buttons?: { id: string; title: string; kind: "path"|"url"; url?: string }[]; quickReplies?: { id: string; title: string }[] }
  | { type: "ai_message" } | { type: "add_tag"; tagId: string } | { type: "remove_tag"; tagId: string }
  | { type: "assign_user"; userId: string } | { type: "move_stage"; stageId: string } | { type: "webhook"; url: string }
  | { type: "close_conversation" } | { type: "handoff_ai" } | { type: "handoff_human" };
type NodeOutcome =
  | { effects: Effect[]; route: { handle: string } }
  | { effects: Effect[]; route: { waitReply: { until: string } } }          // message with path buttons / quick replies
  | { effects: Effect[]; route: { waitDelay: { until: string } } }
  | { effects: Effect[]; route: { awaitEffect: true } }                     // ai_message, webhook: worker supplies the handle
  | { effects: []; route: { end: true } };
function executeNode(graph: AutomationGraph, nodeId: string, ctx: RunContext): NodeOutcome;
function nextNode(graph: AutomationGraph, nodeId: string, handle: string): string | null;
function resolveReply(node: AutomationGraph["nodes"][number], input: { optionId: string | null; text: string | null }): string; // "opt:<id>" | "no_reply"
function evaluateCondition(config: unknown, ctx: RunContext): boolean;
const MAX_STEPS = 50;
```
- `executeNode`:
  - **trigger** → `{handle:"default"}` without effects;
  - **text message** → `send_text` with `renderTemplate` applied;
  - **url-only buttons** → `default`;
  - **delay** → `waitDelay` at `now + minutes`;
  - **business_hours** uses the `timezone` (`Intl.DateTimeFormat`).
- `resolveReply`:
  - an `optionId` belonging to the node → `opt:<id>`;
  - a typed text whose `normalizeText` equals the normalized title of an option → that option;
  - otherwise `no_reply`.

- [ ] **Step 1: Failing tests:**
  - **routes and effects:** each node type produces the expected route and effects;
  - **business_hours:** inside and outside the window for `America/Sao_Paulo` with a fixed `now`;
  - **resolveReply:**
    - a typed `"sim"` matches the option `"Sim"`;
    - a typed `"talvez"` → `no_reply`;
    - an `optionId` from another node → `no_reply`;
  - **nextNode:** returns null on a missing edge.
- [ ] **Step 2–4:** FAIL → implement → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(automation): pure execution engine`.

### Task 4: Core — Instagram (botões, cliques) e modelos

**Files:** Create `packages/core/src/automation/{instagram.ts,templates.ts,instagram.test.ts,templates.test.ts}`; Modify `packages/core/src/channels/instagram/{types.ts,parse.ts,provider.ts,instagram.test.ts}`, `index.ts`.

**Interfaces — Produces:**
```ts
// automation/instagram.ts
type OutboundButtons = { buttons?: {id:string;title:string;kind:"path"|"url";url?:string}[]; quickReplies?: {id:string;title:string}[]; payloads: Record<string,string> }; // optionId → signed payload (built in SQL)
function toInstagramMessage(text: string, opts: OutboundButtons): Record<string, unknown>;
//  quickReplies → {text, quick_replies:[{content_type:"text", title, payload}]}
//  buttons → {attachment:{type:"template", payload:{template_type:"button", text, buttons:[{type:"postback",title,payload}|{type:"web_url",url,title}]}}}
//  none → {text}
// automation/templates.ts
const automationTemplates: { key: "comment_link"|"welcome_direct"|"qualify_buttons"; name: string; triggerType: TriggerType; triggerConfig: unknown; graph: AutomationGraph }[];
// channels/instagram/types.ts: message event gains context.origin "quick_reply" with payload; new event kind
//   | (EventBase & { kind: "button"; senderExternalId: string; title: string; payload: string })
// provider.ts: sendMessage(to, content: OutboundContent & { instagram?: Record<string, unknown> }) sends `instagram` as the message body when present
```
- `parse.ts`:
  - `message.quick_reply.payload` → a `message` event with `context: {origin:"quick_reply", payload}`, keeping the text;
  - `messaging[].postback {mid,title,payload}` → a `button` event with `externalId = postback.mid ?? \`postback:${timestamp}:${sender}\``.
- **Templates:**
  - `comment_link`: comment trigger → message with the path button `"Quero"` → message with a url button → end;
  - `welcome_direct`: message_received first-message → welcome text → end;
  - `qualify_buttons`: keyword `"orçamento"` → message with quick replies `"Sim"`/`"Ainda não"` → add_tag / move_stage → handoff_human; `no_reply` → end.

  Templates hold placeholder references (channel, tag, stage); `validateGraph` with refs containing them returns `[]`.

- [ ] **Step 1: Failing tests:**
  - `toInstagramMessage` body shapes for each of the three cases, with payloads taken from `opts.payloads`;
  - parser fixtures for a quick reply and a postback (Meta format), plus an echo postback ignored;
  - provider sends the `instagram` body verbatim;
  - templates are valid with matching refs.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npm test -w packages/core`, typecheck). Existing Instagram tests still pass.
- [ ] **Step 5: Commit** `feat(automation): instagram buttons, click parsing and templates`.

### Task 5: Banco — esquema e autoria

**Files:** Create `supabase/migrations/20261013000001_automation_schema.sql`, `20261013000002_automation_authoring.sql`, `supabase/tests/database/039_automation_authoring.test.sql`.

**Interfaces — Produces (SQL):**
- **Schema:**
  - enums: `automation_trigger_type` += `instagram_comment`, `instagram_story`; `automation_node_type` += `handoff_ai`, `handoff_human`;
  - `automation_edges.source_handle` check → `^(default|true|false|no_reply|sent|handoff|opt:[a-z0-9]{1,12})$`;
  - `automations` += `trigger_config jsonb not null default '{}'`, `activated_at timestamptz`, `current_version int not null default 0`;
  - `public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph jsonb, created_at, pk(automation_id, version))`.
- **`automation_runs`:**
  - new columns: `version int`, `waiting_for text check in ('delay','reply')`, `wait_node_id uuid`, `attempts int default 0`, `claim_token uuid`, `claimed_until timestamptz`, `iteration int default 0`, `input jsonb` (pending reply/click input);
  - partial index on `(status, resume_at)` for `pending` and `waiting`.
- **Conversations and steps:**
  - `conversations.automation_run_id uuid` (FK to `automation_runs`, `on delete set null`), selectable by members, never writable by `authenticated`;
  - `automation_run_steps` += `handle text`.
- **Instagram and secrets:**
  - `instagram_send_intents` += `message_payload jsonb` and `automation_run_id uuid`;
  - `messages.context` used for `{automation:{runId,nodeId,buttons,quickReplies}}`;
  - `private.automation_secrets(singleton, payload_secret_id uuid)` with a Vault secret created by the migration (random 32 bytes).
- **Authoring** (definer, `has_role(org,'admin')`, else 42501):
  - `save_automation(p_org uuid, p_id uuid, p_name text, p_trigger_type, p_trigger_config jsonb, p_graph jsonb) returns uuid`.
    - Replaces `automation_nodes` and `automation_edges` from `p_graph` (node ids preserved), name 1..100.
    - For an **active** automation it also snapshots a new version (`current_version+1`). Version validity is the caller's job (Task 10 runs `validateGraph` before calling).
  - `activate_automation(p_id) returns int`: snapshots a version, sets `status='active'`, `activated_at=now()`.
  - `pause_automation(p_id)`.
  - `delete_automation(p_id)`: cancels the runs, clears `conversations.automation_run_id` and deletes.
  - `duplicate_automation(p_id) returns uuid`: creates a draft named `"Cópia de …"`.
- **Ruling (plan):** graph validity is enforced in the server action (Task 10) with `validateGraph`; the engine and worker treat a malformed version defensively (run `failed`, code `invalid_graph`). Writes go only through these functions: revoke direct insert, update and delete on automations, nodes and edges from `authenticated`.

- [ ] **Step 1: Failing pgTAP `039`:**
  - the enum values exist;
  - the edge handle check accepts `opt:a1` and rejects `opt:A`;
  - admin save creates nodes and edges;
  - agent and viewer get 42501;
  - another organization's id raises P0002;
  - activate creates version 1 and sets `activated_at`;
  - saving an active automation creates version 2 while version 1 stays intact;
  - duplicate creates a draft;
  - delete cancels a waiting run and clears `conversations.automation_run_id`;
  - members read versions; `authenticated` cannot insert into `automation_runs` or `automation_run_steps`;
  - direct insert into `automation_nodes` by `authenticated` is denied.
- [ ] **Step 2:** `npx supabase db reset && npx supabase test db` — FAIL in 039. **Step 3: Implement.** **Step 4:** PASS (all prior 1047 + new); `npm run db:types`; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(automation): schema, versions and authoring functions`.

### Task 6: Banco — disparo, prioridade sobre a IA, retomada e cancelamento

**Files:** Create `supabase/migrations/20261013000003_automation_dispatch.sql`, `supabase/tests/database/040_automation_dispatch.test.sql`.

**Interfaces:**
- **Consumes:** Task 5; the Phase 6 `ai_enqueue_reply` trigger and `ingest_inbound_message`.
- **Produces:**
  - `ingest_inbound_message` gains a 7-argument variant (`…, p_context jsonb default '{}'`). It stores `context` on insert; the 6-argument variant delegates to it.
  - Trigger `aa_automation_inbound` (AFTER INSERT on `messages`), for inbound contact messages that are not notes. The name sorts before `ai_enqueue_reply`, so it fires first.
    1. If the conversation has a run in `waiting` with `waiting_for='reply'`, set the run's `input` to `{optionId, text}` and make it due now. The `optionId` comes from a valid signed payload in `context.payload` (see `private.automation_verify_payload`); otherwise it is null.
    2. Otherwise, if there is no active run on the conversation, choose the active automation that matches:
       - `keyword_detected` matches with the same rules as `matchKeyword`, implemented in SQL via `private.automation_normalize(text)` with `unaccent`. The `unaccent` extension is created if missing.
       - `message_received` respects `firstMessageOnly`.
       - `instagram_story` matches when `context.origin` is `story_reply` or `story_mention`.
       - Ties go to the oldest `activated_at`, then the lowest id.
       - Insert an `events` row (`automation_trigger`), then the run (`pending`, latest version, `run_after now`), and set `conversations.automation_run_id`.
  - `ai_enqueue_reply` is recreated: it does nothing when `conversations.automation_run_id` points to a run in `pending`, `running` or `waiting`.
  - Triggers on `events` insert for `contact_created`, `tag_added` and `stage_changed`. Check the event names and payloads emitted by the Phase 2/3 triggers and adapt to the real ones. They create runs for the matching active automations, linking the contact's latest open conversation when one exists.
  - Anti-loop: messages with `sender_type='automation'` never trigger.
  - A conversation going to `closed`, or the contact being deleted, cancels its `pending`/`waiting` runs and clears `automation_run_id`.
  - `public.stop_automation(p_conversation uuid)`: agent+; cancels the active run and writes the system message `Automação interrompida por <nome>`.
  - `private.automation_payload(run uuid, node uuid, option text) returns text`: `fa1.<run>.<node>.<option>.<hmac16>`, HMAC-SHA256 with the Vault secret, hex truncated to 16 chars. `private.automation_verify_payload(text) returns jsonb` returns `{runId, nodeId, optionId}` or null.

- [ ] **Step 1: Failing pgTAP `040`:**
  - **Keyword matching:** a keyword match with accents and upper case creates a run, and the AI job is not created.
  - **No match:** a non-matching message creates the AI job as before.
  - **RF1:** with a waiting run, the first message resumes it (input set, due); a second message creates no run and no AI job.
  - **Signed payloads:** a valid payload resolves `optionId`; a tampered payload, or one for another run, gives a null `optionId`.
  - **First message only:** `firstMessageOnly` is ignored after the first message.
  - **Ordering and anti-loop:** the oldest activated automation wins; an automation message does not trigger.
  - **Story:** a story reply triggers `instagram_story`.
  - **CRM events:** `tag_added` with a specific tag triggers, and another tag does not; `contact_created` triggers.
  - **RF2:** pausing keeps waiting runs; deleting cancels them, clears the link, and the next message goes to the AI.
  - **RF3:** deleting the contact cancels the runs.
  - **Closing and stopping:** closing a conversation cancels its waiting runs; `stop_automation` works for an agent and is 42501 for a viewer.
- [ ] **Step 2–4:** reset + test db FAIL → implement → PASS (all suites); db:types; typecheck; `npm test` (web/core unaffected).
- [ ] **Step 5: Commit** `feat(automation): dispatch, AI priority, reply resume and cancellation`.

### Task 7: Banco — fila, aplicação de passos e worker

**Files:** Create `supabase/migrations/20261013000004_automation_queue.sql`, `supabase/tests/database/041_automation_queue.test.sql`.

**Interfaces:**
- **Consumes:** Tasks 5–6; `consume_ai_quota`; Phase 6 helpers for the AI context; Phase 5 intent creation (window check).
- **Produces:**
  - **`claim_automation_runs(p_limit int) returns jsonb`** `[{runId, claimToken}]`. It picks runs that are `pending`, or `waiting` with `resume_at <= now()`, via `for update skip locked`. It sets `running`, attempts+1 and `claimed_until = now()+3 min`.
  - **`prepare_automation_run(p_run uuid, p_token uuid) returns jsonb`.** Returns `{"action":"skip"}` (and cancels the run) when:
    - the run is gone or the token is wrong;
    - the conversation is closed or deleted;
    - the contact is deleted;
    - the run is cancelled.

    Otherwise it returns `{"action":"run", runId, organizationId, conversationId, channelType, currentNodeId, input, waitingFor, stepCount, graph, context: RunContext, ai?: {agent, company, contact, stages, conversation}}`:
    - `graph` is the run's version graph;
    - `ai` is present only when the current node is an `ai` message.
  - **`apply_automation_step(p_run uuid, p_token uuid, p_step jsonb) returns jsonb`** with `p_step = {nodeId, iteration, handle|null, effects: Effect[], route: {next|waitReply|waitDelay|end}, aiReply?: {text, usedChunkIds}, error?: code}`. In one transaction it:
    - inserts `automation_run_steps (run, node, iteration)`; on conflict it returns the stored result (idempotent);
    - applies the effects:
      - tag and remove tag, assign (the member must belong to the org), move stage (the deal is ensured as in Phase 6);
      - close conversation;
      - `handoff_ai` sets `handled_by='ai'`, `status='open'` and clears the run link;
      - `handoff_human` sets `pending_human`/`human` and writes the system text `Automação transferiu para atendimento humano`;
    - handles `send_text`:
      - **Simulator:** a message with `sender_type='automation'`, `status='delivered'` and `context.automation` holding the buttons and quick replies;
      - **Instagram:** the window check, then a message `pending` plus an intent with `message_payload` (the result of `toInstagramMessage` is built by the worker and passed in `effects[].instagram`) and `automation_run_id`. Signed payloads are generated here via `private.automation_payload` and returned in `payloads` (see the two-phase note below). Outside the window the run ends with step result `window_closed`;
    - handles `ai_message`: consumes the reply quota and sends `aiReply.text` like `send_text`;
    - updates the run:
      - `current_node_id = next`, `step_count+1`, status `running`;
      - on a wait: `waiting`, `waiting_for`, `resume_at` and `wait_node_id`;
      - on the end: `completed` and clears the conversation link;
      - more than 50 steps: `failed` with code `max_steps`.

    It returns `{state, intentIds, payloads}`.

    **Two-phase payloads:** the worker first calls **`automation_button_payloads(p_run, p_token, p_node_id) returns jsonb`** (`{optionId: payload}`), builds the Instagram body with those payloads, then calls `apply`.
  - **`fail_automation_run(p_run, p_token, p_code text, p_retryable boolean)`.** The code matches `^[a-z0-9_]{1,64}$` (else `invalid_code`). Backoff is 10/30/90 s up to 3 attempts, then `failed`. When it fails the run, it clears the conversation link so the AI resumes.
  - **`sweep_automation_runs()`:** per-row isolated. Expired claims become retryable failures.
  - **`rerun_automation_from(p_run uuid, p_node uuid)`:** admin. It requires a `failed` or `completed` run; creates a new `iteration`, sets `current_node_id`, `pending`, and relinks the conversation if it has no active run.
  - **Worker config:**
    - `private.automation_worker_config`, `configure_automation_worker(base_url, service_key, worker_secret)`, `read_automation_worker_config()` and `dispatch_automation_worker()` (calls `sweep`; posts only when runs are due);
    - `cron.schedule('flowai-automation-worker','5 seconds', …)`.
  - **Grants:** everything service-only except `rerun_automation_from` (authenticated plus an admin check).

- [ ] **Step 1: Failing pgTAP `041`:**
  - **Claim:** claim and skip-locked behave; a wrong token is a no-op.
  - **Prepare skip:** prepare returns `skip` for a closed conversation (RF3, from the worker's side).
  - **Effects:** `apply` with tag and stage effects is applied once; replaying the same step is idempotent (no double tag event).
  - **Simulator send:** writes the automation message with buttons in `context`.
  - **Instagram send:** creates an intent with `message_payload` and `automation_run_id`; outside the window the step result is `window_closed` and the run is completed.
  - **Waits:** `waitReply` sets waiting/reply with `resume_at = now + timeout`; `waitDelay` likewise.
  - **Step limit:** the 51st step marks the run failed with `max_steps`.
  - **AI quota:** an exhausted `ai_message` quota routes to handoff (the step result says `quota_exceeded` and the worker routes `handoff`; document the contract).
  - **Failures and sweep:** fail/backoff/give-up clears the conversation link; the sweep isolates rows.
  - **Rerun:** admin can rerun; agent gets 42501.
  - **Dispatch and cron:** dispatch without config is a no-op; the cron job exists at 5 seconds; `authenticated` cannot execute service functions.
  - **Payloads:** `automation_button_payloads` returns verifiable payloads.
- [ ] **Step 2–4:** FAIL → implement → PASS (all suites); db:types; typecheck.
- [ ] **Step 5: Commit** `feat(automation): run queue, idempotent step application and worker dispatch`.

### Task 8: Edge — webhook seguro

**Files:** Create `supabase/functions/_shared/safe-webhook.ts`, `supabase/functions/tests/safe-webhook.test.ts`.

**Interfaces — Produces:**
```ts
type Resolver = (host: string) => Promise<string[]>;                      // default: Deno.resolveDns A + AAAA
function isBlockedAddress(ip: string): boolean;                             // 0/8,10/8,100.64/10,127/8,169.254/16,172.16/12,192.168/16,224/4,240/4, ::, ::1, fc00::/7, fe80::/10, ::ffff:<blocked v4>
function postSafeWebhook(url: string, body: unknown, deps: { fetch: typeof fetch; resolve: Resolver; timeoutMs?: number }): Promise<{ ok: true; status: number } | { ok: false; code: "invalid_url"|"blocked_address"|"timeout"|"http_error"|"too_large"|"network_error"; retryable: boolean }>;
```
- `https:` only, with no credentials in the URL.
- Every resolved address is checked, and the request is pinned to the first allowed IP. The Host header keeps the hostname. If pinning is impossible in Deno fetch, resolve and check immediately before the fetch and document the residual DNS-rebinding window in the code.
- `redirect: "manual"`: any 3xx is `http_error` and is not retryable.
- Bodies over 64 KB are `too_large`; 5xx, timeouts and network errors are retryable.

- [ ] **Step 1: Failing tests (RF5):**
  - `http://` rejected;
  - `https://127.0.0.1`, `https://[::1]`, `https://[::ffff:10.0.0.1]` blocked;
  - a resolver returning `169.254.169.254` blocked with fetch never called;
  - a 302 to `http://192.168.0.1` is not followed;
  - 503 is retryable; 200 is ok;
  - a body over 64 KB is `too_large`;
  - a timeout is retryable.
- [ ] **Step 2–4:** `npm run test:edge` FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(automation): SSRF-safe webhook client`.

### Task 9: Edge — `automation-worker` e envio com botões

**Files:** Create `supabase/functions/automation-worker/{handler.ts,index.ts}`, `supabase/functions/tests/automation-worker.test.ts`; Modify `supabase/functions/send-message/handler.ts` (use `message_payload` when present), `supabase/config.toml` (`[functions.automation-worker] verify_jwt = true`).

**Interfaces:**
- **Consumes:** core `executeNode`, `nextNode`, `resolveReply`, `toInstagramMessage`, `runReplyPipeline`; `createOpenAIProvider`; `postSafeWebhook`; the Task 7 RPCs; `sendClaimedInstagram`.
- **Produces:** `handleAutomationWorker(request, deps: AutomationWorkerDeps): Promise<Response>`.
  - Authentication is `x-flowai-worker` compared in constant time; 401 otherwise.
  - Each claimed run is driven synchronously until it waits, ends or fails, with at most 50 steps per invocation:
    1. **Resume input:** when `prepare` returns a waiting-for-reply input, compute `handle = resolveReply(node, input)` (or `no_reply` on timeout) and move to `nextNode`.
    2. **Execute and apply:** call `executeNode` and fill in `instagram` bodies via `automation_button_payloads` and `toInstagramMessage`. Effects that need the network run first:
       - **webhook:** `postSafeWebhook`; on ok the handle is `default`; a retryable error calls `fail(retryable)`; otherwise `fail` with `webhook_<code>`;
       - **ai_message:** `runReplyPipeline`; a handoff or `not_configured` routes `handoff`; `sent` passes `aiReply`.

       Then call `apply_automation_step`.
    3. **Send intents:** send the returned `intentIds` with `claimSend` + `sendClaimedInstagram`.
  - Errors:
    - a DB `42501` is a lost claim: no fail, no retry;
    - a DB `22023` is `fail('invalid_step', false)`;
    - `invalid_graph` when the version graph fails `automationGraphSchema`.
  - Logs carry ids and codes only, through an injectable `log`.
  - `send-message/handler.ts`: when `claim.messagePayload` exists, send it through the provider's `instagram` body (Task 4). `claim_instagram_send` must return `messagePayload`; extend it in a new migration in this task (`20261013000005_instagram_send_payload.sql`) with a pgTAP assertion in `041`.

- [ ] **Step 1: Failing Deno tests** (fake RPCs, fake OpenAI, fake Graph):
  - **Message flow:** a simple flow (trigger → text → end) applies 2 steps and completes.
  - **Buttons:** the payloads are fetched and the Instagram body contains `quick_replies` with them.
  - **Resume after a click:** input `{optionId:"a1"}` follows `opt:a1`; input text `"sim"` matches the title.
  - **Condition:** a false branch is taken.
  - **Delay:** stops after apply returns waiting.
  - **Webhook:** ok continues; blocked fails with `webhook_blocked_address`, not retryable.
  - **AI message:** sent passes `aiReply`; `no_knowledge` routes `handoff`.
  - **Claims and graphs:** `42501` causes no fail; an invalid graph fails with `invalid_graph`; prepare `skip` ends quietly (RF3).
  - **Sending:** intent ids are sent; send-message uses `messagePayload`.
  - **Auth and logs:** a bad secret gives 401; logs contain no message text.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npm run test:edge`, and pgTAP if the migration changed).
- [ ] **Step 5: Commit** `feat(automation): automation worker and instagram button sends`.

### Task 10: Banco — Instagram: comentários e stories via automações, migração das regras

**Files:** Create `supabase/migrations/20261013000006_automation_instagram.sql`, `supabase/tests/database/042_automation_instagram.test.sql`; Modify Phase 5 tests only where their contract legitimately changes (ruling: rules become automations).

**Interfaces:**
- **Consumes:** Tasks 5–9; Phase 5 `ingest_instagram_event`, `prepare_instagram_comment_send`, `reselect_instagram_comment_rule`, `complete_instagram_send`, `instagram_comment_rules`.
- **Produces:**
  - **Ingestion:**
    - `ingest_instagram_event` (create or replace):
      - **Messages:** pass `context` (including `quick_reply` payloads) through the 7-argument ingest.
      - **`button` events:** ingest as an inbound message with text = title and `context = {origin:"button", payload}`, deduplicated by external id.
      - **Comments:** select the matching active `instagram_comment` automation by channel, media and keywords, oldest `activated_at` first. Record `instagram_events.automation_id` and `automation_version`; this replaces the rule fields, which stay nullable for history. Then enqueue the existing verification work.
    - The Phase 5 worker functions are adapted to read from the automation instead of the rule: `prepare_instagram_comment_send` and `reselect_instagram_comment_rule` (renamed only if trivial; otherwise keep the names). The text and buttons for the private reply come from the automation's first message node, rendered with `{nome}` as null (comment senders have no contact yet) and with payloads for the run.
    - On successful verification, a run is created from the comment event: `events` type `automation_trigger` plus a run whose first step is recorded as already sent. When the private reply completes (`complete_instagram_send`, `private_reply` kind), the run is linked to the created conversation and contact, moved to `waiting/reply` on the first message node, and `conversations.automation_run_id` is set.
  - **Migration:** each `instagram_comment_rules` row becomes an automation with trigger `instagram_comment {channelId, mediaId, keywords:[keyword], mode:"contains"}` and graph trigger → message(text = reply_text) → end. Active rules become active with version 1; inactive rules become drafts. The rule table is kept read-only (`revoke insert, update` from authenticated).
  - **Phase 5 actions:** the rule actions return `{ok:false, error:"As regras de comentário agora são automações."}`; Task 13 updates the UI.

- [ ] **Step 1: Failing pgTAP `042`:**
  - **Migration:** active and inactive rules become active automations and drafts.
  - **Comment matching:** a matching comment records `automation_id`, while a non-matching comment or another media is ignored.
  - **Private reply:** completion links the run and conversation and leaves the run waiting for a reply.
  - **Postback resume:** a later postback with a valid payload resumes the run with the option.
  - **Quick replies:** a quick-reply message carries the payload in `context`.
  - **Story:** a story reply triggers an `instagram_story` automation.
  - **Anti-replay:** a duplicated postback external id is ignored.

  Phase 5 tests (`024`–`035`) still pass, adapted only where they asserted rule-table writes.
- [ ] **Step 2–4:** reset + test db FAIL → implement → PASS; `npm run test:edge`. `npm run test:instagram:e2e` runs in Task 14.
- [ ] **Step 5: Commit** `feat(automation): instagram comments and stories through automations`.

### Task 11: Web — lista `/automacoes` e ações

**Files:** Create `apps/web/src/lib/automation/{actions.ts,queries.ts,messages.ts,actions.test.ts}`, `apps/web/src/app/api/automacoes/route.ts`, `apps/web/src/components/automation/automation-list.tsx`; Modify `apps/web/src/app/(app)/automacoes/page.tsx`, `apps/web/vitest.config.ts` (include `src/lib/automation/*.test.ts`).

**Interfaces — Produces:**
- **Server actions** (admin/owner, active org; `ActionResult` pattern from `lib/ai/actions.ts`):
  - `createAutomation(input: { templateKey?: "comment_link"|"welcome_direct"|"qualify_buttons"; name?: string }): Promise<ActionResult<{ id: string }>>` — blank creates a graph with only the trigger, `message_received`;
  - `saveAutomation(input: { id: string; name: string; triggerType; triggerConfig; graph: AutomationGraph }): Promise<ActionResult<{ issues: GraphIssue[] }>>`:
    - loads refs (tags, stages, members, channels) and runs `validateGraph`;
    - for an active automation with issues, refuses with `"Corrija os erros antes de salvar uma automação ativa."`;
  - `activateAutomation(id)` (validates first) → `ActionResult<{ issues }>`;
  - `pauseAutomation(id)`;
  - `duplicateAutomation(id)`;
  - `deleteAutomation(id)`;
  - `rerunFrom(runId, nodeId)`;
  - `stopAutomation(conversationId)` (agent+).
- **`GET /api/automacoes`** → `{ automations: [{id, name, triggerType, status, runs7d, updatedAt}], canWrite }`, query key `["automations", orgId]`.
- **UI:**
  - table with `Nova automação` (dialog: `Em branco` or one of the 3 templates) and per-row `Editar`, `Duplicar`, `Pausar`/`Ativar`, `Excluir` (confirmation: `Excluir automação? As execuções em andamento serão canceladas.`);
  - empty state `Nenhuma automação ainda. Comece por um modelo:` with the 3 template cards;
  - loading, error and retry states; read-only for agent and viewer.

- [ ] **Step 1: Failing Vitest:**
  - agent creating gets the permission message;
  - activate with issues returns them and does not call the RPC;
  - saving an active automation with issues is refused with the exact copy;
  - template creation passes the template graph;
  - an RPC 42501 maps to the permission message.
- [ ] **Step 2–4:** FAIL → implement → PASS; `npm test -w apps/web`, typecheck, lint.
- [ ] **Step 5: Commit** `feat(automation): automations list and actions`.

### Task 12: Web — editor visual

**Files:** Create `apps/web/src/app/(app)/automacoes/[id]/page.tsx`, `apps/web/src/app/api/automacoes/[id]/route.ts`, `apps/web/src/components/automation/{editor.tsx,palette.tsx,node-panel.tsx,graph-mapping.ts,graph-mapping.test.ts,nodes/*.tsx}`; Modify `apps/web/package.json` (add `@xyflow/react` at an exact version at least two weeks old; record it in the report).

**Interfaces:**
- **Consumes:** Task 11 actions; core schemas, `validateGraph`, `requiredHandles`.
- **Produces:**
  - `GET /api/automacoes/[id]` → `{ automation: {id,name,status,triggerType,triggerConfig,currentVersion}, graph, refs: {tags:[{id,name}], stages, members, channels:[{id,name,type}]}, canWrite }`.
  - `toFlow(graph): {nodes, edges}` and `fromFlow(nodes, edges): AutomationGraph` in `graph-mapping.ts`. They are pure and keep positions and handles.
  - **Editor:**
    - palette: drag a block type into the canvas;
    - one custom node per type showing a summary and one output handle per `requiredHandles` entry, labeled `Sim`/`Não`, the button titles, `Sem resposta`, `Enviada`/`Transferiu`;
    - side panel with an RHF + Zod form per type, using the selects from `refs`;
    - live `validateGraph`: issues listed in a panel, nodes with issues outlined, clicking an issue selects the node;
    - toolbar: name field, `Salvar rascunho`, `Ativar` / `Pausar`, status badge;
    - unsaved-changes guard on navigation;
    - read-only canvas for non-admins.

- [ ] **Step 1: Failing Vitest:**
  - `graph-mapping.test.ts`: the round trip is identical for each template;
  - removing a quick reply drops its edge;
  - handles are derived from `requiredHandles`.
- [ ] **Step 2–4:** FAIL → implement → PASS; typecheck; lint. Smoke-run `npm run build -w apps/web` to catch React Flow SSR issues (the editor is a client component, loaded with `dynamic(..., { ssr:false })` if needed).
- [ ] **Step 5: Commit** `feat(automation): visual flow editor`.

### Task 13: Web — execuções, Inbox e Canais

**Files:** Create `apps/web/src/components/automation/runs.tsx`, `apps/web/src/app/api/automacoes/[id]/runs/route.ts`, `apps/web/src/lib/inbox/automation-display.ts`(+test); Modify `apps/web/src/components/inbox/{message-bubble.tsx,conversation-header.tsx,conversation-view.tsx}`, `apps/web/src/lib/inbox/{queries.ts,actions.ts,actions.test.ts}`, `apps/web/src/components/settings/instagram/comment-rules.tsx`, `apps/web/src/lib/instagram/actions.ts`.

**Interfaces:**
- **Consumes:** `stop_automation`, `rerun_automation_from`, a new `click_automation_button(p_message_id uuid, p_option_id text)` added in this task's own migration `20261013000007_automation_simulator_click.sql`:
  - agent+; simulator channel only;
  - the message must be an automation message with that option;
  - it ingests an inbound contact message with text = option title and `context.payload = private.automation_payload(...)`;
  - plus pgTAP `043`.
- **Produces:**
  - **"Execuções" tab:** list with status, contact, start and end (`GET …/runs`, last 50). Expanding a run shows its steps (node summary, handle, result code, time) and `Reexecutar a partir deste passo` (admin) on failed or completed runs.
  - **Inbox:**
    - badge `Automação` for `sender_type='automation'`;
    - buttons and quick replies rendered under the bubble (from `context.automation`); clickable for agent+ on Simulator conversations (calls `clickAutomationButton`), read-only otherwise; url buttons open in a new tab with `rel="noopener noreferrer"`;
    - header shows `Em automação: {nome}` with `Parar automação` (agent+) when `automation_run_id` points to an active run.
  - **Canais:** the comment-rules section is replaced by `As regras de comentário agora são automações.` and the link `Gerenciar em Automações` to `/automacoes`.

- [ ] **Step 1: Failing tests:**
  - **pgTAP `043`:** a click by an agent on a simulator automation message resumes the waiting run with the option; a click on an Instagram conversation gives 22023; a viewer gets 42501; an unknown option gives 22023.
  - **Vitest:** button rendering helper (clickable rules); `stopAutomation` and `clickAutomationButton` action mappings; header visibility helper.
- [ ] **Step 2–4:** FAIL → implement → PASS (pgTAP, `npm test -w apps/web`, typecheck, lint); run `npx playwright test inbox` from `apps/web` (existing 13 still pass).
- [ ] **Step 5: Commit** `feat(automation): runs history, inbox buttons and channels notice`.

### Task 14: E2E, documentação e verificação final

**Files:** Create `supabase/functions/tests/serve-automation-e2e.ts` (port 54328; handlers `automation-worker` + `instagram-worker` + `meta-webhook` + `send-message`, fake Graph, fake OpenAI; `/__test__/run-automation-worker`), `scripts/test-automation-e2e.mjs` (pause `flowai-automation-worker`, `flowai-ai-worker` and `flowai-instagram-worker`; configure the workers; restore in `finally`; port-in-use check; sanitized stderr), `apps/web/playwright.automation.config.ts` (port 3103), `apps/web/e2e/automation.spec.ts`, `docs/superpowers/fase-7a-pendencias.md`; Modify root `package.json` (`"test:automation:e2e"`), `apps/web/playwright.config.ts` and `playwright.integration.config.ts` (`testIgnore` + `automation.spec.ts`), `README.md`.

- [ ] **Step 1: Write the spec `automation.spec.ts`.** Each scenario uses `signUpWithOrg` plus DB-driven draining of the worker until there are no pending or running runs, as Phase 6 did.
  1. **Builder:**
     - create from `Qualificar lead com botões`;
     - configure the tag and the stage in the panel;
     - `Ativar`, and the status is `Ativa`.
  2. **Simulator flow:**
     - simulate `"Quero um orçamento"`, and the automation message appears with the `Automação` badge and the buttons `Sim`/`Ainda não`;
     - `Em automação: …` is shown and no AI reply is created;
     - click `Sim`; after draining, the contact panel shows the tag, the deal is in the stage, and the conversation is `pending_human` with the system text `Automação transferiu para atendimento humano`.
  3. **Stop:** with a waiting run, `Parar automação` removes the header and the system message appears.
  4. **Delay resumes:**
     - a flow with trigger → delay 1 min → text;
     - after the first drain the run is `waiting`;
     - move `resume_at` to the past through the psql helper, drain again, and the message appears.
  5. **Instagram comment:**
     - with the Instagram fixture from `e2e/support/instagram.ts`, a migrated or new comment automation;
     - post a signed comment webhook and drain both workers;
     - the Graph proxy receives a private reply with a postback button;
     - post the signed postback, drain, and the follow-up message is sent through the Graph proxy.
  6. **Runs tab:** the run list shows the completed run with its steps.
- [ ] **Step 2: Run** `npm run test:automation:e2e` — Expected: FAIL until the harness exists, then 6 passed. Run it twice to show stability.
- [ ] **Step 3: Write the docs.**
  - `fase-7a-pendencias.md`:
    - decisions and rulings;
    - pending items, including live validation of postbacks, quick replies and the `messaging_postbacks` subscription, and the button templates allowed in private replies (to validate with a real app);
    - evidence counts.
  - README: the command, the Phase 7A links and the webhook security note.
- [ ] **Step 4: Full verification, sequentially** (close other apps; at least ~600 MB free):
  - `npm test`;
  - `npm run typecheck`;
  - `npm run lint -w apps/web`;
  - `npx supabase db reset && npx supabase test db`;
  - `npm run test:edge`;
  - `npm run e2e -w apps/web`;
  - `npm run test:ai:e2e`;
  - `npm run test:instagram:e2e`;
  - `npm run test:automation:e2e`.

  Then `select jobname, active from cron.job` shows all four jobs active. Record the counts.
- [ ] **Step 5: Commit** `test(automation): end-to-end flows, docs and verification`.
