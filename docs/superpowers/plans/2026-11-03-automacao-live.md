# Automação para comentários em live — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quem comentar numa live do Instagram recebe uma DM por live, configurado no gatilho "Comentário" (origem Posts / Lives / Ambos) pelo painel ou pelo Claude (MCP).

**Architecture:** O webhook passa a assinar `live_comments`; o leitor converte esses eventos em `kind: "comment"` com `mediaProductType: "LIVE"`. O gatilho `instagram_comment` ganha `trigger_config.source`; as duas funções SQL de seleção de regra filtram pela origem e contam a "uma vez por contato" por live. A resposta pública ignora eventos LIVE. Envio da DM: caminho existente, sem mudanças no worker.

**Tech Stack:** Next 16 / React 19, Zod 4, Vitest, Supabase Postgres (plpgsql, pgTAP), Edge Functions Deno 2.

**Spec:** `docs/superpowers/specs/2026-11-03-automacao-live-design.md`

## Global Constraints

- Nenhum teste chama Meta, OpenAI ou hosts reais.
- `trigger_config.source`: `"posts" | "lives" | "both"`; ausente = `"posts"` (automações existentes não mudam).
- Com `source = "lives"`: `mediaId` deve ser `null` e `publicReplies` vazio/ausente.
- Comentário de live nunca gera resposta pública.
- Textos de interface e erros em português; rótulos: "Comentário na live" (lives), "Comentário em post ou live" (ambos).
- Aviso no formulário, texto exato: "Só envia enquanto a live estiver no ar."
- Chave de serviço nunca em `apps/web`. Deploys (migração, Edge) são feitos pelo usuário.
- Ramo: `feat/automacao-live`.

## Review Focus

- Automação "qualquer post" existente (sem `source`) recebendo um comentário LIVE → não dispara (Task 3, teste pgTAP 1).
- Duas lives seguidas da mesma pessoa → DM nas duas; dois comentários na mesma live → uma DM (Task 3, testes 4–5).
- Evento LIVE em automação "ambos" com respostas públicas → DM sim, resposta pública não (Task 3, teste 6).
- Payload `live_comments` sem `media.media_product_type` → ainda vira LIVE (Task 2, teste 2).
- `reselect_instagram_comment_rule` (troca de regra após falha) respeita a origem igual à seleção inicial (Task 3, teste 7).

---

### Task 1: Verificar o payload real de `live_comments` (spike, sem código mantido)

**Files:** nenhum no repositório; resultado anotado no ledger.

- [ ] **Step 1:** Pela documentação atual da Meta (Instagram API with Instagram Login → Webhooks), confirmar que o campo `live_comments` existe para Instagram Login e anotar o formato de `value` (esperado: `id`, `from {id, username}`, `text`, `media {id, media_product_type}`).
- [ ] **Step 2:** Anotar no ledger: formato confirmado ou diferenças. Se o formato divergir, ajustar a Task 2 (leitor) antes de executá-la. A confirmação com live real fica para o roteiro de teste final (o usuário faz a live).

### Task 2: Leitor de eventos + assinatura do webhook

**Files:**
- Modify: `packages/core/src/channels/instagram/parse.ts:73-76`
- Modify: `supabase/functions/meta-connection/handler.ts:139` (`subscribed_fields`)
- Test: `packages/core/src/channels/instagram/instagram.test.ts`, `supabase/functions/tests/meta-connection.test.ts`

**Interfaces:**
- Produces: evento `{ kind: "comment", mediaProductType: "LIVE", mediaId: <id da live>, commentId, senderExternalId, senderName, text, ... }` (mesmo tipo `InstagramEvent` de hoje).

- [ ] **Step 1: Testes que falham** em `instagram.test.ts`:
  1. `parses live_comments as a LIVE comment`: envelope `{ object: "instagram", entry: [{ id: "acc", time: 1700000000, changes: [{ field: "live_comments", value: { id: "c1", from: { id: "u1", username: "ana" }, text: "oi", media: { id: "live1", media_product_type: "LIVE" } } }] }] }` → `[{ kind: "comment", commentId: "c1", mediaId: "live1", mediaProductType: "LIVE", senderExternalId: "u1", senderName: "ana", text: "oi" }]` (toMatchObject).
  2. `forces LIVE when live_comments omits media_product_type`: mesmo payload sem `media_product_type` → `mediaProductType: "LIVE"`.
  3. Em `meta-connection.test.ts`, no teste existente da ação `test`, a asserção do corpo do `subscribed_apps` passa a esperar `["messages", "comments", "live_comments", "messaging_seen", "messaging_postbacks"]`.
- [ ] **Step 2:** Rodar `npx vitest run packages/core/src/channels/instagram` e `deno test supabase/functions/tests/meta-connection.test.ts` (comando do repo, ver `package.json`) → FAIL.
- [ ] **Step 3:** Em `parse.ts`, tratar `change.field === "comments" || change.field === "live_comments"` no mesmo ramo; para `live_comments`, `mediaProductType: "LIVE"`. Em `handler.ts`, incluir `"live_comments"` na lista na ordem do teste.
- [ ] **Step 4:** Rodar de novo → PASS (e a suíte inteira de `packages/core` sem regressão).
- [ ] **Step 5:** Commit `feat(instagram): ler comentários de live e assinar live_comments`.

### Task 3: Origem no gatilho + seleção de regra por live (banco)

**Files:**
- Modify: `packages/core/src/automation/schemas.ts:90-104`
- Create: `supabase/migrations/20261103000001_instagram_live_comments.sql`
- Test: `packages/core/src/automation/schemas.test.ts`, Create `supabase/tests/database/060_instagram_live_comments.test.sql`

**Interfaces:**
- Consumes: payload do evento com `mediaProductType` (Task 2; `ingest_instagram_event` grava `p_event` inteiro em `payload`).
- Produces: `trigger_config.source?: "posts" | "lives" | "both"` aceito pelo esquema e pelo banco; helper SQL `private.instagram_comment_source_matches(p_config jsonb, p_payload jsonb) returns boolean` (immutable).

- [ ] **Step 1: Testes de esquema que falham** (`schemas.test.ts`, `triggerConfigSchemas.instagram_comment`):
  - aceita `source: "lives"` com `mediaId: null` e sem `publicReplies`;
  - rejeita `source: "lives"` com `mediaId: "123"` (mensagem "Comentários de live valem para qualquer live; não escolha um post.");
  - rejeita `source: "lives"` com `publicReplies: ["oi"]` (mensagem "A Meta não permite resposta pública em comentário de live.");
  - aceita config sem `source` (como hoje).
- [ ] **Step 2:** Implementar `source: z.enum(["posts","lives","both"]).optional()` e as duas regras no `superRefine` existente → PASS.
- [ ] **Step 3: pgTAP que falha** (`060_instagram_live_comments.test.sql`, seguindo o padrão de `053_instagram_comment_once_per_user.test.sql` e `056_comment_public_reply.test.sql` para fixtures de canal/conexão/automação e chamada a `public.ingest_instagram_event`):
  1. automação sem `source`, `mediaId` null + evento com `mediaProductType: "LIVE"` → `state = 'ignored'`;
  2. automação `source: "lives"` + evento de post (sem `mediaProductType`) → `ignored`;
  3. automação `source: "lives"` + evento LIVE → `pending`;
  4. mesma pessoa, segundo comentário na mesma live (`mediaId` igual) → `ignored`;
  5. mesma pessoa, comentário em outra live (`mediaId` diferente) → `pending`;
  6. automação `source: "both"` com `publicReplies` + evento LIVE → `pending` e nenhuma linha em `instagram_comment_public_replies` para o evento; evento de post na mesma automação → cria linha;
  7. `reselect_instagram_comment_rule` em evento LIVE não seleciona automação `source` ausente.
- [ ] **Step 4:** Rodar `npx supabase test db` (Docker ligado pelo usuário) → FAIL nos novos testes.
- [ ] **Step 5: Migração.** Criar `private.instagram_comment_source_matches(p_config, p_payload)`:
  ```sql
  select case coalesce(p_config->>'source','posts')
    when 'both' then true
    when 'lives' then p_payload->>'mediaProductType' = 'LIVE'
    else p_payload->>'mediaProductType' is distinct from 'LIVE' end
  ```
  Redefinir `public.ingest_instagram_event` copiando **literalmente** a versão de `20261017000001_instagram_ad_comments.sql` e `public.reselect_instagram_comment_rule` copiando a de `20261022000001_comment_public_reply.sql`, mudando só:
  - `and private.instagram_comment_source_matches(v.trigger_config, <payload do evento>)` na seleção (`p_event` no ingest, `ev.payload` no reselect);
  - no `not exists` do `oncePerUser`: `and (<payload>->>'mediaProductType' is distinct from 'LIVE' or prev.payload->>'mediaId' = <payload>->>'mediaId')`.
  Redefinir `private.bind_instagram_comment_public_reply` (versão de `20261022000001`) com uma única mudança: após calcular `texts`, `if p_event.payload->>'mediaProductType'='LIVE' then texts:='{}'; end if;`. Manter `grant`/`revoke` iguais aos originais (conferir com `\df+` / os arquivos de origem).
- [ ] **Step 6:** `npx supabase db reset` + `npx supabase test db` → todos PASS (inclusive 053, 054, 056).
- [ ] **Step 7:** Commit `feat(db): gatilho de comentário com origem posts/lives/ambos e uma vez por live`.

### Task 4: Painel (formulário, rótulos, resumo)

**Files:**
- Modify: `apps/web/src/components/automation/forms/mappings.ts:125-190`, `apps/web/src/components/automation/forms/trigger-form.tsx:165-192`, `apps/web/src/lib/automation/node-summary.ts:39-42`
- Test: `apps/web/src/components/automation/forms/mappings.test.ts`, `apps/web/src/components/automation/forms/comment-trigger.test.ts`

**Interfaces:**
- Consumes: `source` do esquema (Task 3).
- Produces: campo de formulário `source: "posts" | "lives" | "both"` (padrão `"posts"`).

- [ ] **Step 1: Testes que falham:**
  - `mappings.test.ts`: config sem `source` → valores do form com `source: "posts"`; form `source: "lives"` com `mediaId` preenchido e respostas públicas ligadas → config `{ source: "lives", mediaId: null, publicReplies: [] }`; form `"posts"` → config **sem** a chave `source` (não suja automações antigas); `"both"` → `source: "both"`.
  - `comment-trigger.test.ts`: com "Lives" selecionado, o seletor de post e o campo de respostas públicas não aparecem e o texto "Só envia enquanto a live estiver no ar." aparece.
- [ ] **Step 2:** Rodar `npx vitest run apps/web/src/components/automation/forms` → FAIL.
- [ ] **Step 3:** Implementar: em `mappings.ts`, campo `source` na leitura/gravação conforme os testes; em `trigger-form.tsx`, `<select>` "Onde" (Posts / Lives / Ambos, usando `selectClass`) acima do seletor de post, escondendo `InstagramMediaPicker` e `PublicRepliesField` quando `source === "lives"`, e com o texto de ajuda "Respostas públicas valem só para posts." quando `"both"`. Em `node-summary.ts`, linha "Na live" / "Em post ou live" conforme `c.source`. Ajustar o texto de ajuda do "uma vez por pessoa" para lives: "Na live, cada pessoa recebe uma vez por live."
- [ ] **Step 4:** Rodar de novo → PASS; `npx tsc -p apps/web --noEmit` limpo.
- [ ] **Step 5:** Commit `feat(web): escolher posts, lives ou ambos no gatilho de comentário`.

### Task 5: Claude (MCP) com `gatilho: "live"`

**Files:**
- Modify: `packages/core/src/mcp/automation-spec.ts` (enum `gatilho`, refine, `GATILHO_LABEL`, `summarizeSpec`, `specToTrigger`, `needsOpening`)
- Modify: `apps/web/src/lib/mcp/tools/automations-write.ts:66-75` (descrições, `post` em `rowSummary`), `apps/web/src/lib/mcp/tools/automations-read.ts:12-26` (`triggerLabel`)
- Test: `packages/core/src/mcp/automation-spec.test.ts`, `apps/web/src/lib/mcp/mcp.test.ts`

**Interfaces:**
- Consumes: `source` (Task 3).
- Produces: `triggerLabel(type: string, config?: unknown): string` — `"live"` quando `type === "instagram_comment"` e `config.source === "lives"`; demais casos como hoje. Todos os chamadores passam `trigger_config`.

- [ ] **Step 1: Testes que falham:**
  - `automation-spec.test.ts`: `specToTrigger({ gatilho: "live", palavras: [], ... })` → `{ type: "instagram_comment", config: { channelId, mediaId: null, anyKeyword: true, keywords: [], mode: "any", oncePerUser: true, source: "lives" } }` sem `publicReplies`; `gatilho: "live"` com `respostaPublica: ["oi"]` → erro "A Meta não permite resposta pública em comentário de live."; com `post: "123"` → erro "Comentários de live valem para qualquer live; não escolha um post."; `gatilho: "live"` com `followUp` gera o botão de abertura (mesma regra do comentário); `summarizeSpec` contém "comentário em live".
  - `mcp.test.ts`: `criar_automacao` com `gatilho: "live"` grava `trigger_config.source = "lives"`; `listar_automacoes` mostra `gatilho: live` para essa automação.
- [ ] **Step 2:** Rodar `npx vitest run packages/core/src/mcp apps/web/src/lib/mcp` → FAIL.
- [ ] **Step 3:** Implementar conforme os testes. Na regra existente `spec.gatilho !== "comentario"` (respostaPublica/post), `live` ganha as mensagens próprias acima. `needsOpening`/`opening` passam a valer para `comentario` e `live`. Descrição do `gatilho` na ferramenta: `"comentario: palavra em comentário de post; live: comentário durante uma live (DM uma vez por live, só enquanto a live está no ar); dm: palavra em mensagem direta; story: resposta a story."`. A checagem de automação duplicada (`automations-write.ts:277`) passa a comparar também `source`.
- [ ] **Step 4:** Rodar de novo → PASS; suítes completas `npx vitest run` e `npx tsc --noEmit` nos pacotes afetados limpos.
- [ ] **Step 5:** Commit `feat(mcp): gatilho live no formato simples`.

### Task 6: Guia e roteiro do teste real

**Files:**
- Modify: `docs/superpowers/mcp-setup.md`

- [ ] **Step 1:** Adicionar seção "Automação de live": (1) no painel da Meta, marcar `live_comments` nos campos do webhook do app; (2) no FlowAI, Canais → "Testar conexão" (reassina os campos); (3) roteiro: criar automação com origem "Lives", fazer uma live curta, comentar de outra conta → DM chega; comentar de novo → nenhuma DM; em outra live → DM de novo.
- [ ] **Step 2:** Commit `docs: guia da automação de live`.

## Deploy (feito pelo usuário, após merge)

1. `npx supabase functions deploy meta-connection`
2. `npx supabase db push`
3. `git push` (Vercel)
4. Painel da Meta: marcar `live_comments`; FlowAI: "Testar conexão".
