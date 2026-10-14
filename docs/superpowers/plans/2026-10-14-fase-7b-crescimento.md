# Fase 7B — Links de entrada, sequências e campanhas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Links/QR de entrada que disparam automações, sequências de mensagens em segundo plano e campanhas segmentadas com botões que iniciam automações, respeitando a janela de 24h do Instagram.

**Architecture:** Lógica pura (schemas, código de link, próximo horário com janela/fuso, filtros de público, referral do Instagram, gatilho/blocos novos no motor) em `packages/core`. Banco: tabelas novas com RLS e funções de autoria; ingestão de referral; inscrição/saída de sequências; foto do público de campanhas; fila única `outreach_deliveries` com reserva/conclusão idempotente, reaproveitando os envios e o payload assinado da 7A. O `automation-worker` ganha o processamento de entregas. Três abas novas em `/automacoes`.

**Tech Stack:** Postgres 17 (pgcrypto, pg_cron, pg_net, Vault), Deno 2, TypeScript + Zod 4, Next.js 16 + React Query + RHF + shadcn/ui, biblioteca de QR (`qrcode` npm, versão exata publicada há ≥ 2 semanas), Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-fase-7b-crescimento-design.md` (base: spec e código da 7A).

**Referências de execução:** [mapa ChatbotX](../referencias-chatbotx.md), autorizado em 2026-10-14. Consultar nas Tasks 9–11 para padrões de interface e testes; a spec e os contratos do FlowAI prevalecem. Na Task 12, avaliar os cenários candidatos de referral descritos no mapa. Isso não autoriza importar backend, dependências ou recursos fora do escopo.

## Global Constraints

- Ambiente: Docker PATH prefix; `DENO_BIN`/`DENO_DIR` do workspace da Fase 5; e2e local com `FLOWAI_E2E_SLOW_HOST=1` (host de 8 GB); rodar suítes uma de cada vez.
- Nunca editar migrations já no `master` (até `20261013000009`); novas começam em `supabase/migrations/20261014000001_*.sql`; pgTAP novos a partir de `046_`.
- Funções SECURITY DEFINER com `search_path=''`, nomes qualificados, `revoke … from public, anon` (e `authenticated` quando só serviço), grants explícitos; tabelas com RLS, sem policy para `anon`, `revoke truncate, references, trigger`, grants por coluna; escrita do app só por funções.
- Nenhum teste chama Meta, OpenAI ou hosts externos. Logs/códigos sem texto de mensagem.
- Código de link: gerado com 8 caracteres `[a-z0-9]`; definido pelo admin: `^[a-z0-9_-]{3,40}$`; único por canal. Nome 1–100. Link Instagram: `https://ig.me/m/<usuário>?ref=<código>`.
- Passo de sequência: espera 1 min a 30 dias (43200 min) após o passo anterior (o primeiro conta da inscrição); janela opcional (dias 1–7 ISO + `HH:MM` início < fim, fuso da organização).
- Mensagem de sequência/campanha: texto ≤ 1000 bytes no Instagram e ≤ 4096 caracteres no Simulador; até 3 botões (`url` HTTPS ou `automation` com `automationId`) **ou** até 13 respostas rápidas (cada uma com `automationId`); título ≤ 20; texto com botões ≤ 640; variáveis `{primeiro_nome}`/`{nome}`.
- Palavras de saída padrão `sair`, `parar`, `cancelar`; o contato sai quando a mensagem inteira, normalizada (sem acento/maiúsculas/pontuação nas pontas), é igual a uma delas.
- Adiamento por conversa ocupada: 10 min, até 6 vezes; depois `skipped` com motivo `conversation_busy`. Motivos de pulo: `window_closed`, `conversation_busy`, `no_conversation`; falhas com códigos `^[a-z0-9_]{1,64}$`.
- Ritmo de campanha: 30 envios/minuto/canal (configurável em `private.outreach_settings`).
- Payload assinado de entrega: `fd1.<delivery>.<option>.<hmac16>` (HMAC-SHA256 com o segredo Vault da 7A sobre `<delivery>.<option>`).
- Copy fixa: nota "Entrou pelo link {nome}"; prévia "N no público · M dentro da janela de 24h · K ficarão de fora"; confirmação "Enviar campanha para M contatos?"; abas "Links de entrada", "Sequências", "Campanhas"; botão do Simulador "Simular abertura por link".
- Permissões: admin/owner criam/editam links, sequências e campanhas e enviam campanhas; agent inscreve/remove contato em sequência pela ficha; viewer só lê.

## Review Focus

1. **Evento de referral repetido pela Meta** → um único uso registrado, uma única execução, uma única nota. Teste no Task 4.
2. **Janela de horário que cai no fim de semana / fora do expediente** (sexta 18h com janela seg–sex 9–18 → segunda 9h no fuso da organização; horário de verão de outros fusos IANA). Teste no Task 1.
3. **Palavra de saída dentro de frase** ("não quero parar agora") não remove o contato; "Parar!" remove. Teste no Task 5.
4. **Campanha cancelada com entrega em `sending`** → essa termina normalmente; as pendentes viram `cancelled`; contadores consistentes. Teste no Task 7.
5. **Cron ou worker parado na hora agendada da campanha** → a foto do público acontece uma única vez quando o worker voltar, sem duplicar entregas. Teste no Task 6.

---

## File Structure

```
packages/core/src/growth/{schemas.ts,link.ts,schedule.ts,audience.ts,message.ts,index.ts,*.test.ts}
packages/core/src/automation/{schemas.ts,validate.ts,engine.ts}            (gatilho entry_link, blocos sequence_enroll/remove)
packages/core/src/channels/instagram/{parse.ts,types.ts}                   (evento referral)
supabase/migrations/20261014000001_growth_schema.sql          tabelas, enums, RLS, autoria
supabase/migrations/20261014000002_entry_link_ingest.sql      referral, simulação, usos, gatilho
supabase/migrations/20261014000003_sequences_runtime.sql      inscrição, saída, agendamento de passos
supabase/migrations/20261014000004_campaigns_runtime.sql      público, prévia, foto, cancelamento, relatório
supabase/migrations/20261014000005_outreach_queue.sql         fila de entregas, cliques fd1, dispatch
supabase/tests/database/046..050_*.test.sql
supabase/functions/automation-worker/{handler.ts,index.ts}    (+ entregas); supabase/functions/meta-connection (usuário da conta)
apps/web/src/lib/growth/{actions.ts,queries.ts,messages.ts,*.test.ts}
apps/web/src/app/api/{links,sequencias,campanhas}/... , apps/web/src/app/(app)/automacoes/{links,sequencias,campanhas}/page.tsx
apps/web/src/components/growth/{automation-tabs.tsx,entry-links.tsx,qr-download.tsx,sequences.tsx,sequence-editor.tsx,campaigns.tsx,campaign-wizard.tsx,campaign-report.tsx,outreach-message-form.tsx}
apps/web/src/components/inbox/{simulate-dialog.tsx,contact-panel.tsx}       (simular link; seção Sequências)
apps/web/src/components/automation/{forms/*,nodes/*}                         (gatilho/blocos novos)
apps/web/e2e/growth.spec.ts, apps/web/playwright.growth.config.ts, scripts/test-growth-e2e.mjs
docs/superpowers/fase-7b-pendencias.md, README.md
```

---

### Task 1: Core — schemas, código de link, horário e público

**Files:** Create `packages/core/src/growth/{schemas.ts,link.ts,schedule.ts,audience.ts,message.ts,index.ts}` + tests; Modify `packages/core/src/index.ts`.

**Interfaces — Produces:**
```ts
const entryLinkInputSchema;      // {name 1..100 trim, channelId uuid, code?: /^[a-z0-9_-]{3,40}$/, tagId: uuid|null}
function generateLinkCode(random?: () => number): string;          // 8 chars [a-z0-9]
function instagramEntryLink(username: string, code: string): string; // https://ig.me/m/<username>?ref=<code> (username URL-encoded)
const outreachMessageSchema;     // {text, buttons?: {id,title,kind:"url"|"automation",url?,automationId?}[≤3], quickReplies?: {id,title,automationId}[≤13]}
                                  // ids /^[a-z0-9]{1,12}$/ unique; buttons xor quickReplies; url https; automation needs automationId
function validateOutreachMessage(msg, channelType: "simulator"|"instagram"): { code: string; message: string }[]; // 1000 bytes / 4096 chars / 640 with buttons
const sendWindowSchema;          // {days:(1..7)[] unique non-empty, start:"HH:MM", end:"HH:MM", start<end} | null
const sequenceStepSchema;        // {delayMinutes 1..43200, window: sendWindow|null, message: outreachMessage}
const sequenceSettingsSchema;    // {channelIds uuid[] ≥1, exitOnReply boolean (default false), exitWords string[] (default ["sair","parar","cancelar"], each 1..30)}
function nextSendTime(fromIso: string, delayMinutes: number, window: SendWindow|null, timeZone: string): string; // ISO UTC
const audienceFilterSchema;      // {channelIds uuid[]≥1, tagsAll uuid[], tagsAny uuid[], tagsNone uuid[], stageIds uuid[], minLeadScore 0..100|null, lastInteractionDays 1..365|null, entryLinkIds uuid[]}
function isExitWord(text: string, exitWords: string[]): boolean;   // whole normalized message equals a word
```

- [ ] **Step 1: Failing tests.**
  - **Links:**
    - `generateLinkCode` matches `^[a-z0-9]{8}$`;
    - `instagramEntryLink("loja.x","promo10")` returns `"https://ig.me/m/loja.x?ref=promo10"`.
  - **Mensagens e schemas:**
    - outreach messages: 4 buttons fail; an automation button without `automationId` fails; `http://` fails;
    - 641 characters with buttons fails on Instagram; 1001 bytes fails on Instagram;
    - `sendWindow` with start ≥ end fails.
  - **`nextSendTime` (RF2):**
    - `("2026-10-16T21:00:00Z" /*sexta 18:00 SP*/, 1, {days:[1,2,3,4,5],start:"09:00",end:"18:00"}, "America/Sao_Paulo")` returns `"2026-10-19T12:00:00Z"` (segunda 09:00 SP);
    - no window → from + delay;
    - inside the window → unchanged;
    - `America/New_York` across the 2026-11-01 DST change keeps 09:00 local.
  - **`isExitWord` (RF3):**
    - `"Parar!"` → true;
    - `"não quero parar agora"` → false;
    - `"  SAIR "` → true.
  - **Audience filter:** an empty `channelIds` fails.
- [ ] **Step 2–4:** `npm test -w packages/core` FAIL → implement → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(growth): core schemas, link codes, schedule and audience`.

### Task 2: Core — motor e Instagram

**Files:** Modify `packages/core/src/automation/{schemas.ts,validate.ts,engine.ts}` (+tests), `packages/core/src/channels/instagram/{parse.ts,types.ts,instagram.test.ts}`.

**Interfaces — Produces:**
- Gatilho `entry_link` com config `{linkIds: uuid[] ≥1}`.
- Blocos `sequence_enroll {sequenceId}` e `sequence_remove {sequenceId}`; `requiredHandles` → `["default"]`.
- `executeNode` → efeitos `{type:"sequence_enroll", sequenceId}` / `{type:"sequence_remove", sequenceId}` com handle `default`.
- `GraphRefs` ganha `sequenceIds: string[]` e `entryLinkIds: string[]`; o validador gera os issues `unknown_sequence` e `unknown_entry_link`.
- Instagram: novo `InstagramEvent` `{kind:"referral"; senderExternalId; ref; source: string|null; externalId}`.
  - Vem de `messaging[].referral {ref, source, type}`, com `externalId = referral:<timestamp>:<sender>`.
  - Quando `message.referral` chega junto de uma mensagem, a mensagem ganha `context.referral = {ref}`.
  - Ecos são ignorados; as checagens de destinatário são as mesmas das mensagens.
- [ ] **Step 1: Failing tests.**
  - O validador aceita `entry_link` com link conhecido e recusa desconhecido.
  - Blocos de sequência validam e executam como acima.
  - Parser:
    - referral sozinho → evento `referral`;
    - mensagem com `referral` → `context.referral.ref`;
    - destinatário errado lança erro.
  - Os testes existentes continuam passando.
- [ ] **Step 2–4:** FAIL → implement → PASS (`npm test -w packages/core`, typecheck).
- [ ] **Step 5: Commit** `feat(growth): entry_link trigger, sequence nodes and instagram referral`.

### Task 3: Banco — esquema e autoria

**Files:** Create `supabase/migrations/20261014000001_growth_schema.sql`, `supabase/tests/database/046_growth_schema.test.sql`.

**Interfaces — Produces (SQL):**
- **Enums:** gatilho `entry_link`; tipos de nó `sequence_enroll` e `sequence_remove`.
- **`channels.instagram_username text`:** escrito pelo serviço; selecionável por membros.
- **Tabelas** (todas com `organization_id`, FKs compostas, RLS de leitura para membros, sem escrita direta por `authenticated`):
  - `entry_links`: id, name, channel_id, code, tag_id, status `active|archived`, created_at. Único `(channel_id, code)`.
  - `entry_link_hits`: id, link_id, contact_id, conversation_id, external_id, created_at. Único `(link_id, external_id)`.
  - `sequences`: id, name, status `draft|active|paused`, settings jsonb, created_at, updated_at.
  - `sequence_steps`: id, sequence_id, position, delay_minutes, window jsonb, message jsonb. Único `(sequence_id, position)` deferrable.
  - `sequence_enrollments`: id, sequence_id, contact_id, channel_id, current_position, next_send_at, status `active|completed|exited|removed`, exit_reason, created_at. Índice único parcial: um `active` por `(sequence_id, contact_id)`.
  - `campaigns`: id, name, status `draft|scheduled|sending|completed|cancelled`, audience jsonb, message jsonb, scheduled_at, started_at, finished_at, counters jsonb.
  - `outreach_deliveries`: id, source `sequence|campaign`, enrollment_id, step_id, campaign_id, contact_id, channel_id, conversation_id, run_after, status `pending|sending|sent|skipped|failed|cancelled`, reason, postponements int, attempts int, claim_token, claimed_until, message_id, intent_id, created_at, updated_at.
    - Índice único parcial por `(campaign_id, contact_id)`.
    - Índice único por `(enrollment_id, step_id)`, garantindo um passo por inscrição.
  - `private.outreach_settings`: singleton com `campaign_rate_per_minute int default 30`.
- **Autoria** (todas `has_role(org,'admin')`; caso contrário 42501):
  - `save_entry_link(p_org, p_id, p_input jsonb) returns uuid`: o código é gerado em SQL quando ausente.
  - `archive_entry_link(p_id)`.
  - `save_sequence(p_org, p_id, p_name, p_settings jsonb, p_steps jsonb) returns uuid`: substitui os passos e mantém os ids dos passos enviados.
  - `set_sequence_status(p_id, p_status)`.
  - `delete_sequence(p_id)`: cancela as entregas pendentes.
  - `save_campaign(p_org, p_id, p_name, p_audience jsonb, p_message jsonb) returns uuid`: só em `draft`.
  - `delete_campaign(p_id)`: só em `draft`.
  - Validação estrutural no SQL (22023): formatos e limites. A validação completa fica nas server actions, com o core.
- **Edge `meta-connection`:** grava `instagram_username` quando a verificação da conta devolve `username`. Se ausente, o admin pode informar em Canais.
  - Função `set_instagram_username(p_channel, p_username)`, só admin, com `^[a-z0-9._]{1,30}$`.
  - Teste no edge + pgTAP.
- [ ] **Step 1: Failing pgTAP `046`:**
  - tabelas e RLS existem;
  - membro lê só a própria organização;
  - escrita direta negada;
  - autoria por admin funciona; agent e viewer recebem 42501;
  - código duplicado no mesmo canal dá 23505 mapeado para 22023 (`code_taken`);
  - código gerado tem 8 caracteres;
  - um ativo por (sequência, contato);
  - `save_campaign` fora de `draft` dá 22023.
- [ ] **Step 2–4:** reset + test db FAIL → implement → PASS (todas as suítes); `npm run db:types`; typecheck; `npm run test:edge`.
- [ ] **Step 5: Commit** `feat(growth): schema and authoring functions`.

### Task 4: Banco — entrada por link

**Files:** Create `supabase/migrations/20261014000002_entry_link_ingest.sql`, `supabase/tests/database/047_entry_link_ingest.test.sql`.

**Interfaces:**
- **Consumes:** Task 3; as ingestões das fases 5 e 7A (`ingest_instagram_event`, `private.ingest_inbound_core`, `private.automation_inbound`, `private.automation_start_run`).
- **Produces:**
  - `private.entry_link_open(p_channel uuid, p_sender text, p_code text, p_external_id text, p_contact uuid default null) returns jsonb`. Em ordem:
    1. resolve o link `active`; se for desconhecido, retorna `{ignored:true}`;
    2. garante contato e conversa, no mesmo padrão da ingestão;
    3. registra o uso de forma idempotente por `(link, external_id)` (RF1);
    4. escreve a nota de sistema `Entrou pelo link {nome}`;
    5. aplica a tag do link, se houver;
    6. se a conversa estiver livre (sem execução ativa e sem `pending_human`, regras da 7A), inicia a automação `entry_link` ativa que contém o link, a mais antiga ativada; se estiver ocupada, só conta o uso.
  - **Instagram:** `ingest_instagram_event` passa a tratar `kind='referral'` chamando `entry_link_open`, e mensagens com `context.referral` chamam essa função antes da ingestão da mensagem. Assim, quando o link inicia uma execução, a mensagem não dispara outra.
  - **Simulador:** `public.simulate_entry_link(p_link uuid, p_contact_phone text, p_contact_name text) returns uuid` (conversa), para agent ou superior, só no canal Simulador.
  - **Prioridade:** a dispatch de mensagens da 7A nunca inicia um gatilho de mensagem para uma mensagem que trouxe `context.referral` válido.
- [ ] **Step 1: Failing pgTAP `047`:**
  - abertura no Simulador cria a conversa, a nota, a tag e a execução;
  - código desconhecido é ignorado, mas a mensagem que veio junto entra;
  - link arquivado é ignorado;
  - conversa ocupada conta o uso sem iniciar execução;
  - **RF1:** o mesmo `external_id` duas vezes gera um uso, uma execução e uma nota;
  - referral junto da mensagem inicia apenas a automação do link;
  - outra organização não resolve o código;
  - `simulate_entry_link` dá 42501 para viewer e 22023 para canal que não é Simulador.
- [ ] **Step 2–4:** FAIL → implement → PASS; db:types; typecheck.
- [ ] **Step 5: Commit** `feat(growth): entry link ingestion and trigger`.

### Task 5: Banco — sequências em execução

**Files:** Create `supabase/migrations/20261014000003_sequences_runtime.sql`, `supabase/tests/database/048_sequences_runtime.test.sql`.

**Interfaces:**
- **Consumes:** Tasks 3 e 4; `apply_automation_step` da 7A (efeitos novos) e `automation_inbound` (saída por palavra ou resposta).
- **Produces:**
  - `private.sequence_enroll(p_sequence uuid, p_contact uuid, p_actor text) returns uuid|null`:
    - só para sequência `active` e contato com conversa no canal da sequência (senão cria a inscrição e o primeiro passo dá `no_conversation`);
    - duplicidade é ignorada e registrada como evento `sequence_enroll_ignored`;
    - agenda a entrega do primeiro passo com `run_after = nextSendTime(now, step.delay, window, tz)`, mesma regra do core em SQL (`private.next_send_time`).
  - `private.sequence_remove(p_sequence, p_contact, p_reason)`: cancela as entregas pendentes.
  - **Públicas para a ficha (agent ou superior):** `enroll_contact_in_sequence(p_sequence, p_contact) returns uuid` e `remove_contact_from_sequence(p_sequence, p_contact)`.
  - **Efeitos em `apply_automation_step`** (create or replace numa migration nova): `sequence_enroll` e `sequence_remove` chamam as funções privadas acima.
  - **Saída por mensagem:** um trigger depois de `automation_inbound` (nome posterior em ordem alfabética), para mensagem inbound de contato:
    - `isExitWord` em SQL (`private.is_exit_word`) → `exited` com motivo `exit_word` e nota "Saiu da sequência {nome}";
    - `exitOnReply` → `exited` com motivo `replied`.
  - **Agendamento do próximo passo:** `private.sequence_schedule_next(p_enrollment)`, chamado pela conclusão da entrega (Task 7). Avança `current_position` e cria a próxima entrega ou marca `completed`.
  - **Pausa e retomada:**
    - pausar congela: entregas pendentes viram `cancelled` com motivo `paused`;
    - reativar recria a entrega do passo atual a partir de agora.
  - **Contato excluído:** remove de todas as sequências.
- [ ] **Step 1: Failing pgTAP `048`:**
  - inscrição pelo bloco e pela ficha;
  - duplicidade ignorada;
  - `run_after` respeita a janela;
  - **RF3:** "não quero parar agora" mantém a inscrição; "Parar!" sai, com nota;
  - `exitOnReply`;
  - pausar e retomar;
  - contato excluído;
  - agent pode inscrever; viewer recebe 42501;
  - sequência em `draft` recusa inscrição (22023).
- [ ] **Step 2–4:** FAIL → implement → PASS; db:types; typecheck.
- [ ] **Step 5: Commit** `feat(growth): sequence enrollment, exits and scheduling`.

### Task 6: Banco — campanhas

**Files:** Create `supabase/migrations/20261014000004_campaigns_runtime.sql`, `supabase/tests/database/049_campaigns_runtime.test.sql`.

**Interfaces — Produces:**
- `public.preview_campaign_audience(p_org uuid, p_audience jsonb) returns jsonb` → `{total, inWindow, outOfWindow}`.
  - Membro da organização; SECURITY INVOKER ou definer com checagem de membro.
  - Os filtros seguem `audienceFilterSchema`.
  - "Dentro da janela" = existe mensagem inbound de contato nas últimas 24h na conversa do canal (Instagram). No Simulador, sempre dentro.
- `public.schedule_campaign(p_id uuid, p_at timestamptz|null) returns void`: admin; `draft` → `scheduled` (null significa agora).
- `public.cancel_campaign(p_id)`: admin. Entregas `pending` viram `cancelled`; as em `sending` terminam (RF4); a campanha vai para `cancelled`.
- `private.start_due_campaigns()`, chamado por `dispatch_automation_worker`:
  - campanhas `scheduled` com `scheduled_at <= now()` → `sending`, com `for update skip locked`, uma única vez (RF5);
  - tira a foto do público: quem está dentro da janela vira entrega `pending` com `run_after` escalonado conforme `campaign_rate_per_minute`, por canal; quem está fora vira entrega `skipped` com `window_closed`;
  - nunca duplica, por causa do índice único `(campaign_id, contact_id)`.
- `public.campaign_report(p_id) returns jsonb` → `{counts:{sent,skipped:{reason:n},failed:{reason:n},cancelled}, clicks:{optionId:n}, recipients:[...] (paginado p_limit/p_offset)}`.
- Fim da campanha: `completed` quando não restam entregas `pending` ou `sending`.
- [ ] **Step 1: Failing pgTAP `049`:**
  - os filtros, um por um (tagsAll, tagsAny, tagsNone, etapa, score, última interação, link);
  - os números da prévia;
  - a foto separa dentro e fora da janela;
  - o escalonamento respeita o ritmo;
  - **RF5:** chamar `start_due_campaigns` duas vezes não duplica entregas;
  - **RF4:** cancelar com uma entrega em `sending` termina essa e cancela as pendentes;
  - viewer recebe 42501 em `schedule_campaign`;
  - outra organização dá P0002.
- [ ] **Step 2–4:** FAIL → implement → PASS; db:types; typecheck.
- [ ] **Step 5: Commit** `feat(growth): campaign audience, snapshot, pacing and cancel`.

### Task 7: Banco — fila de entregas e cliques

**Files:** Create `supabase/migrations/20261014000005_outreach_queue.sql`, `supabase/tests/database/050_outreach_queue.test.sql`.

**Interfaces:**
- **Consumes:** Tasks 3–6; da 7A, `private.automation_send_blocker`, `private.automation_deliver` (envio para Simulador e intents do Instagram), `private.automation_conversation_busy`, o segredo Vault, `private.automation_click_kind`, `private.automation_start_run` e `dispatch_automation_worker`.
- **Produces:**
  - `claim_outreach_deliveries(p_limit int) returns jsonb` → `[{deliveryId, claimToken}]`, com skip locked e reserva de 3 min.
  - `prepare_outreach_delivery(p_id, p_token) returns jsonb` → `{action:"skip"}` ou `{action:"send", deliveryId, organizationId, channelType, conversationId, contact:{name}, message, payloads:{optionId: "fd1…"}}`.
  - `complete_outreach_delivery(p_id, p_token, p_result jsonb) returns jsonb`, idempotente. `p_result` traz o `instagram` body montado pelo worker. Em uma transação:
    - confere de novo se a campanha ou a inscrição está ativa e se o contato existe;
    - **conversa:** sem conversa → `skipped no_conversation`; ocupada → adia 10 min, com `postponements+1`; depois de 6 adiamentos → `skipped conversation_busy`;
    - janela fechada → `skipped window_closed`;
    - **envia:** `sender_type='automation'`, `context.outreach={deliveryId, buttons, quickReplies}`. Simulador grava `delivered`; Instagram cria o intent com `message_payload`;
    - grava `sent` e, em sequência, chama `sequence_schedule_next`;
    - **resultado:** `{state, intentIds}`.
  - `fail_outreach_delivery(p_id, p_token, p_code, p_retryable)`, com backoff de 10 s e 30 s em até 3 tentativas. A sweep marca reservas expiradas.
  - **`dispatch_automation_worker`** (create or replace): também roda `start_due_campaigns()` e chama o worker quando há entregas vencidas.
  - **Cliques `fd1`:** a ingestão das fases 7A/9 reconhece o prefixo `fd1`.
    - Payload válido e da mesma organização e contato, opção de automação → registra o clique (evento `outreach_click` com `deliveryId` e `optionId`) e inicia a automação na conversa se ela estiver livre (regras da 7A).
    - Assinatura válida mas opção ou entrega antiga → entra como texto, igual à 7A.
    - Forjado → descartado.
- [ ] **Step 1: Failing pgTAP `050`:**
  - claim e prepare;
  - envio no Simulador e no Instagram (intent com payload);
  - replay idempotente;
  - **os três motivos de pulo:** sem conversa, conversa ocupada (com 6 adiamentos) e janela fechada;
  - sequência agenda o próximo passo e termina como `completed`;
  - entrega de campanha cancelada é pulada;
  - fail com backoff e sweep;
  - **cliques:** clique `fd1` inicia a automação e conta o clique; clique forjado é descartado;
  - **dispatch:** inicia campanhas vencidas e chama o worker;
  - `authenticated` não executa as funções de serviço.
- [ ] **Step 2–4:** FAIL → implement → PASS; db:types; typecheck.
- [ ] **Step 5: Commit** `feat(growth): outreach delivery queue and click handling`.

### Task 8: Edge — worker de entregas

**Files:** Modify `supabase/functions/automation-worker/{handler.ts,index.ts}`, `supabase/functions/tests/{automation-worker.test.ts,rpc-contract.test.ts}`.

**Interfaces:**
- **Consumes:** Task 7 RPCs; `toInstagramMessage`, `renderTemplate`, `sendClaimedInstagram`.
- **Produces:** depois das execuções de automação, o worker drena as entregas, dentro do mesmo orçamento de tempo.
  - Ciclo de cada entrega: `prepare`; renderiza o texto; monta o corpo do Instagram com `payloads` (um `invalid_content` vira `fail` não retryable); `complete`; envia os intents.
  - DB 42501 conta como reserva perdida; 22023 vira `fail('invalid_step', false)`; 40P01 e 40001 são retryable.
  - Os novos RPCs são cobertos pelo teste de contrato da 7A.
- [ ] **Step 1: Failing Deno tests:**
  - entrega de Simulador enviada;
  - entrega de Instagram com quick replies, cujo payload é `fd1`;
  - skip termina sem erro;
  - adiamento;
  - corpo inválido dá `invalid_content`;
  - o contrato de nomes de argumento passa.
- [ ] **Step 2–4:** `npm run test:edge` FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(growth): automation worker drains outreach deliveries`.

### Task 9: Web — Links de entrada e Simulador

**Files:** Create `apps/web/src/lib/growth/{actions.ts,queries.ts,messages.ts}` (+tests), `apps/web/src/app/api/links/route.ts`, `apps/web/src/app/(app)/automacoes/links/page.tsx`, `apps/web/src/components/growth/{automation-tabs.tsx,entry-links.tsx,qr-download.tsx}`; Modify `apps/web/src/app/(app)/automacoes/page.tsx` (abas), `apps/web/src/components/inbox/simulate-dialog.tsx`, `apps/web/package.json` (`qrcode` exato).

- **Abas em `/automacoes`:** "Fluxos" (a lista atual), "Links de entrada", "Sequências" e "Campanhas", com rotas `/automacoes`, `/automacoes/links`, `/automacoes/sequencias` e `/automacoes/campanhas`.
- **Server actions** (admin): `saveEntryLink`, `archiveEntryLink`, `simulateEntryLink` (agent+), `setInstagramUsername`.
- **Links de entrada:**
  - colunas: nome, código, link pronto, usos (total e 7 dias), automação ligada, status;
  - "Copiar link", "Baixar QR (PNG)", "Baixar QR (SVG)" (gerado no cliente com `qrcode`) e "Arquivar";
  - Instagram sem usuário mostra o aviso "Informe o usuário do Instagram em Canais para gerar o link.".
- **Simulador:** o diálogo de simulação ganha "Simular abertura por link" (escolher link, telefone e nome).
- **Editor da 7A:** o painel do gatilho ganha `entry_link` com seleção múltipla de links; `loadGraphRefs` passa a incluir `entryLinkIds` e `sequenceIds`.
- [ ] **Step 1: Failing Vitest:**
  - mapeamento de erros das actions (`code_taken` → "Este código já está em uso neste canal.");
  - geração do link;
  - a função pura do QR gera SVG não vazio.
- [ ] **Step 2–4:** FAIL → implement → PASS; typecheck; lint; build uma vez.
- [ ] **Step 5: Commit** `feat(growth): entry links tab, QR and simulator`.

### Task 10: Web — Sequências e ficha do contato

**Files:** Create `apps/web/src/app/api/sequencias/route.ts`, `apps/web/src/app/api/sequencias/[id]/route.ts`, `apps/web/src/app/(app)/automacoes/sequencias/page.tsx`, `apps/web/src/app/(app)/automacoes/sequencias/[id]/page.tsx`, `apps/web/src/components/growth/{sequences.tsx,sequence-editor.tsx,outreach-message-form.tsx}`; Modify `apps/web/src/lib/growth/*`, `apps/web/src/components/inbox/contact-panel.tsx`, `apps/web/src/components/automation/{forms/*,nodes/*}`.

- **Lista:** nome, status, passos, inscritos ativos, envios em 7 dias; "Nova sequência", "Ativar"/"Pausar", "Excluir".
- **Editor de passos:**
  - adicionar, remover e reordenar;
  - espera com número + unidade (min, h, dias);
  - janela de horário opcional;
  - mensagem com o `outreach-message-form` compartilhado: texto, botões de link ou de automação com seletor de automações ativas, e respostas rápidas;
  - configurações: canais, `exitOnReply`, palavras de saída;
  - validação com o core, e o mesmo padrão de "alterações não salvas" do editor da 7A.
- **Ficha do contato:** seção "Sequências" com as sequências ativas, o próximo envio previsto, "Remover" e "Inscrever" (seletor). Fica disponível para agent ou superior.
- **Editor da 7A:** blocos "Inscrever na sequência" e "Remover da sequência" na paleta e no painel.
- [ ] **Step 1: Failing Vitest:**
  - actions (permissão, mapeamento 22023);
  - ida e volta do formulário de mensagem;
  - conversão de unidades da espera;
  - aviso de limite de 640 caracteres com botões.
- [ ] **Step 2–4:** FAIL → implement → PASS; typecheck; lint.
- [ ] **Step 5: Commit** `feat(growth): sequences tab, step editor and contact panel`.

### Task 11: Web — Campanhas

**Files:** Create `apps/web/src/app/api/campanhas/route.ts`, `apps/web/src/app/api/campanhas/[id]/route.ts`, `apps/web/src/app/(app)/automacoes/campanhas/page.tsx`, `apps/web/src/app/(app)/automacoes/campanhas/[id]/page.tsx`, `apps/web/src/components/growth/{campaigns.tsx,campaign-wizard.tsx,campaign-report.tsx}`; Modify `apps/web/src/lib/growth/*`.

- **Lista** com status e contadores.
- **Assistente em 3 passos:**
  1. Público: filtros com seletores de canais, tags, etapas e links, e a prévia ao vivo `N no público · M dentro da janela de 24h · K ficarão de fora`.
  2. Mensagem: `outreach-message-form` com a prévia do balão.
  3. Envio: "Agora" ou data e hora no fuso da organização, com a confirmação `Enviar campanha para M contatos?`.
- **Relatório:** contadores por motivo, cliques por botão ou resposta rápida e lista paginada de destinatários; "Cancelar campanha" enquanto estiver `scheduled` ou `sending`.
- **Permissões:** só admin ou owner envia e cancela.
- [ ] **Step 1: Failing Vitest:**
  - actions (agendar, cancelar, permissão, campanha que não está em rascunho);
  - texto da prévia;
  - conversão de data e hora para UTC no fuso da organização.
- [ ] **Step 2–4:** FAIL → implement → PASS; typecheck; lint.
- [ ] **Step 5: Commit** `feat(growth): campaigns wizard, preview and report`.

### Task 12: E2E, documentação e verificação final

**Files:** Create `apps/web/e2e/growth.spec.ts`, `apps/web/playwright.growth.config.ts`, `scripts/test-growth-e2e.mjs` (reaproveita o harness da 7A: `scripts/lib/owned-process.mjs`, `harness-state.mjs`, `serve-automation-e2e.ts`), `docs/superpowers/fase-7b-pendencias.md`; Modify root `package.json` (`test:growth:e2e`), `apps/web/playwright.config.ts` e `playwright.integration.config.ts` (`testIgnore` + `growth.spec.ts`), `README.md`.

- [ ] **Step 1: Spec com cenários isolados**, drenando o worker pelo banco:
  1. **Link no Simulador:** criar link com tag; "Simular abertura por link"; a nota, a tag e a automação `entry_link` aparecem.
  2. **Sequência pela ficha:**
     - criar sequência de 2 passos (1 min cada);
     - inscrever o contato pela ficha;
     - avançar `run_after` pelo psql e drenar: o passo 1 aparece;
     - responder "parar": o contato sai e a nota aparece;
     - o passo 2 não é enviado.
  3. **Campanha:** filtro por tag; a prévia mostra os números; "Agora"; drenar; a mensagem com resposta rápida aparece; clicar no Simulador inicia a automação; o relatório mostra 1 enviado e 1 clique.
  4. **Campanha cancelada:** agendar para o futuro e cancelar; nenhuma entrega é enviada.
  5. **Instagram (proxy falso):** referral assinado pelo webhook inicia a automação do link, e um segundo envio do mesmo evento não duplica.
- [ ] **Step 2: Run** `npm run test:growth:e2e` — FAIL até o harness existir; depois 5 passed, duas vezes.
- [ ] **Step 3: Docs.**
  - `fase-7b-pendencias.md`:
    - decisões e rulings;
    - pendências: validação real do referral e de `ig.me` com app Meta; ritmo ideal da Meta; WhatsApp para sequências e campanhas fora da janela;
    - tabela de evidências.
  - README: comandos e links.
- [ ] **Step 4: Verificação completa, sequencial** (com memória livre suficiente):
  - `npm run test:scripts`;
  - `npm test`;
  - `npm run typecheck`;
  - `npm run lint -w apps/web`;
  - `npx supabase db reset && npx supabase test db`;
  - `npm run test:edge`;
  - `npm run e2e -w apps/web`;
  - `npm run test:ai:e2e`;
  - `npm run test:instagram:e2e`;
  - `npm run test:automation:e2e`;
  - `npm run test:growth:e2e`;
  - crons ativos.

  Registrar as contagens.
- [ ] **Step 5: Commit** `test(growth): end-to-end flows, docs and verification`.
