# Automações do Instagram via MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O usuário cria, edita, pausa e acompanha automações de DM do Instagram conversando com o Claude por um conector MCP remoto autenticado com OAuth da própria conta FlowAI.

**Architecture:** Um formato simples de automação (core, puro) é convertido no grafo normal da 7A e salvo por uma RPC nova; a rota `/mcp` do app Next (SDK oficial, Streamable HTTP sem sessão) age com o JWT do usuário emitido pelo servidor OAuth 2.1 do Supabase. O motor ganha "uma vez por contato" em DM/story, links rastreáveis `/r/<código>` e uma função de resultados; uma Edge Function com cron renova o token do Instagram.

**Tech Stack:** Next 16 / React 19, `@modelcontextprotocol/sdk`, Supabase (Postgres, pgTAP, Vault, pg_cron, OAuth 2.1 server, Edge Functions Deno 2), Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-mcp-automacoes-design.md`

## Global Constraints

- Nenhum teste chama Meta, OpenAI ou hosts externos reais.
- Chave de serviço nunca em `apps/web`; o MCP usa só o JWT do usuário (RLS + RPCs com checagem de papel). Tokens/segredos nunca em logs, respostas ou erros.
- SQL: SECURITY DEFINER com `search_path=''`, nomes qualificados, revoke de public/anon (e authenticated quando service-only), grants explícitos, RLS em tabelas novas, FKs compostas com `organization_id`. Nunca editar migrations já na `master` (até `20261022000001`); redefinir com `create or replace` em migration nova (a última definição vale; copiar a anterior literalmente + a mudança e conferir com diff).
- Migrations novas: `20261027000001_mcp_automations.sql` (Task 2), `20261027000002_tracked_links_results.sql` (Task 3), `20261027000003_meta_token_refresh.sql` (Task 4). pgTAP novos: `057_mcp_automations`, `058_tracked_links_results`, `059_meta_token_refresh`.
- Dependências npm com versão exata publicada há ≥ 2 semanas.
- Textos para o usuário e descrições de ferramentas em pt-BR. Limites do formato simples (spec §2): nome 1–100; palavras 0–20; respostaPublica 0–10 textos ≤ 300 caracteres; dm.texto ≤ 1000 bytes UTF-8; botões 0–3, título ≤ 20, URL https; follow-up 1 min–7 dias.
- Durações aceitas: `^\s*(\d+)\s*(min|m|h|d)\s*$` (min/m = minutos); intervalo 1–10080 minutos.
- Ambiente local: ver `.superpowers/sdd/<plan>/implementer-rules.md` (Docker PATH, Deno, `FLOWAI_E2E_SLOW_HOST=1`).

## Review Focus

1. Token OAuth expirado, de outro projeto ou de usuário sem organização → `401`/erro claro, nunca dados de outra organização (Task 5 testes `rejects_*`).
2. `editar_automacao` com campos parciais que tornariam a automação inválida, ou sobre automação alterada no painel sem confirmação → recusa explicada, nada muda (Task 7 `edit_*`).
3. Renovação do token enquanto o worker envia: o token antigo continua válido; a renovação não pode invalidar reservas em andamento (Task 4 `refresh_keeps_generation`).
4. `/r/<código>` com código inexistente, malformado ou longo → página "Link inválido", nunca redireciono para URL não armazenada (Task 3/8 `open_tracked_link_*`).
5. Duas automações ativas com o mesmo gatilho, palavra e post → `criar_automacao`/`ativar_automacao` avisa no resumo qual outra automação conflita (Task 7 `warns_overlap`).

---

### Task 1: Core — formato simples de automação

**Files:**
- Create: `packages/core/src/mcp/automation-spec.ts`, `packages/core/src/mcp/automation-spec.test.ts`
- Modify: `packages/core/src/index.ts` (exportar)

**Interfaces:**
- Produces:
  - `automationSpecSchema` (Zod) e `type AutomationSpec` com os campos da spec §2 (`nome, gatilho, palavras, post, respostaPublica, dm{texto,botoes[{titulo,url}]}, botaoDeAbertura?, followUp?{depois,texto,botoes}, umaVezPorContato`).
  - `parseDuration(text: string): number | null` (minutos).
  - `specToGraph(spec: AutomationSpec, ctx: { channelId: string }): AutomationGraph` (tipo do grafo existente em `packages/core/src/automation`), válido no esquema de grafo existente.
  - `mergeSpec(base: AutomationSpec, patch: Partial<AutomationSpec>): AutomationSpec` (patch raso; `dm`/`followUp` substituídos inteiros quando presentes; `followUp: null` remove).
  - `summarizeSpec(spec: AutomationSpec): string` (resumo pt-BR de 1–6 linhas).

- [ ] **Step 1: Testes que falham** em `automation-spec.test.ts`:
  - `accepts_minimal_comment_spec` (padrões: `post: "qualquer"`, `umaVezPorContato: true`, `respostaPublica: []`).
  - `rejects_limits`: 21 palavras, 11 respostas, resposta de 301 caracteres, dm.texto de 1001 bytes, 4 botões, título de 21, URL `http://`, `respostaPublica`/`post` em gatilho `dm` (mensagem em pt-BR).
  - `parses_durations`: `"2h"→120`, `"30min"→30`, `"1d"→1440`, `"90m"→90`, `"0h"→null`, `"8d"→null`, `"2 horas"→null`.
  - `comment_without_followup_sends_links_directly`: grafo trigger→message(botões url)→end; trigger `instagram_comment` com `keywords`, `mediaId` null para "qualquer", `oncePerUser`, `publicReplies`.
  - `comment_with_followup_uses_opening_button`: message(texto + botão `path` com título `botaoDeAbertura ?? "Quero!"`) → message(links) → delay(minutos) → message(follow-up).
  - `dm_and_story_triggers_have_no_opening_button` (`keyword_detected` com `anyKeyword` quando `palavras` vazio; `instagram_story`).
  - `graph_is_valid`: todo grafo gerado passa no esquema de grafo existente.
  - `merge_and_summary`: `mergeSpec` com `followUp: null` remove; `summarizeSpec` contém nome, gatilho e palavras.
- [ ] **Step 2:** `npm run test -w packages/core -- automation-spec` → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar; ids de nó determinísticos (`t`, `m1`, `m2`, `d1`, `m3`, `e`) e posições em coluna (x fixo, y += 160).
- [ ] **Step 4:** Mesmo comando → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(mcp): simple automation spec and graph compiler`.

### Task 2: Banco — automações do MCP e "uma vez por contato" em DM/story

**Files:** Create `supabase/migrations/20261027000001_mcp_automations.sql`, `supabase/tests/database/057_mcp_automations.test.sql`; Modify `packages/core/src/automation/schemas.ts` (+ teste) e `packages/core/src/db/database.types.ts` (gerado).

**Interfaces:**
- Consumes: `public.save_automation` (última definição em `20261022000001`), `activate_automation(p_id) returns int`, `pause_automation(p_id)`, `delete_automation(p_id)`; seleção de gatilhos DM/story (última definição — `grep` em todas as migrations; hoje em `20261014000002`).
- Produces:
  - Colunas `automations.mcp_spec jsonb null`, `automations.mcp_spec_stale boolean not null default false` (select para authenticated).
  - `public.save_mcp_automation(p_org uuid, p_id uuid, p_name text, p_spec jsonb, p_graph jsonb, p_confirm_overwrite boolean default false) returns uuid` — admin/owner; `p_id` null cria; com `p_id` de automação sem `mcp_spec` → `22023 not_mcp_automation`; com `mcp_spec_stale` e sem confirmação → `22023 panel_modified`; salva pelo caminho de `save_automation` (mesmas validações) e grava `mcp_spec`, `mcp_spec_stale=false`.
  - `save_automation` redefinido: se a automação tem `mcp_spec`, marca `mcp_spec_stale=true`.
  - `oncePerUser` aceito em `keyword_detected` e `instagram_story` (Zod e SQL); a seleção ignora a automação se o contato já tem execução dela (qualquer estado exceto falha antes do primeiro envio).

- [ ] **Step 1: pgTAP `057` que falha:** cria via `save_mcp_automation`; viewer/agent → 42501; outra organização → P0002; `not_mcp_automation`; salvar pelo `save_automation` marca stale; `panel_modified` sem confirmação e sucesso com `p_confirm_overwrite`; DM com palavra e `oncePerUser` dispara uma vez para o mesmo contato e de novo para outro; idem story; sem `oncePerUser` dispara duas vezes.
- [ ] **Step 2:** `npx supabase db reset && npx supabase test db supabase/tests/database/057_mcp_automations.test.sql` → FAIL.
- [ ] **Step 3:** Implementar a migration (redefinições = cópia literal + mudança) e o Zod; teste Vitest `accepts_once_per_user_on_dm_and_story`.
- [ ] **Step 4:** pgTAP completo, `npm run db:types`, testes core, typecheck → PASS.
- [ ] **Step 5: Commit** `feat(mcp): mcp-owned automations and once-per-contact on DM and story`.

### Task 3: Banco — links rastreáveis, resultados e contatos

**Files:** Create `supabase/migrations/20261027000002_tracked_links_results.sql`, `supabase/tests/database/058_tracked_links_results.test.sql`; Modify tipos gerados.

**Interfaces:**
- Consumes: todo construtor de botão `web_url` na última definição (`grep -rn "web_url" supabase/migrations`: `private.instagram_comment_body`, o de mensagens do motor e o de `outreach`).
- Produces:
  - Tabelas `public.tracked_links(id, organization_id, code text unique ~ '^[a-z0-9]{12}$', automation_id, run_id, contact_id null, button_title, url text check (url ~ '^https://'), created_at)` e `public.tracked_link_clicks(id, organization_id, link_id, clicked_at)`; RLS select por membro; sem escrita para authenticated.
  - Singleton `private.tracked_link_settings(base_url text)` com `'https://flowai-web-rust.vercel.app'` inserido; `null` desliga o rastreio.
  - `private.tracked_button_url(p_run uuid, p_title text, p_url text) returns text` — cria o código (reaproveita o mesmo para a mesma execução + título + URL) e devolve `<base_url>/r/<code>`; sem base ou sem execução devolve `p_url`.
  - Construtores `web_url` redefinidos para usar `tracked_button_url`.
  - `public.open_tracked_link(p_code text) returns text` — executável por `anon`; código fora do padrão ou inexistente → `null`; registra clique (limite: 30 cliques/min por código) e devolve a URL armazenada.
  - `public.automation_results(p_org uuid, p_from timestamptz, p_to timestamptz, p_automation uuid default null) returns jsonb` → `[{automationId, name, status, runs, dmsSent, publicReplies, clicks:{total, byButton:{title:n}}, uniqueContacts}]`; membro; intervalo máx. 90 dias (`22023`).
  - `public.mcp_contacts(p_org uuid, p_search text, p_automation uuid, p_limit int) returns jsonb` → `[{id, name, username, lastInteractionAt, automations:[name]}]`; membro; `p_limit` 1–100.

- [ ] **Step 1: pgTAP `058` que falha:** mensagem com botão de link gera URL `/r/<12>` e o mesmo código para reenvio; sem base_url mantém a URL original; `open_tracked_link` como anon devolve a URL e registra clique; código inexistente/`'../x'`/200 caracteres → null; anon não lê as tabelas; `automation_results` conta execuções, DMs, respostas públicas, cliques e contatos únicos no período e respeita organização; 91 dias → 22023; `mcp_contacts` filtra por busca e automação.
- [ ] **Step 2:** rodar `058` → FAIL. **Step 3:** implementar. **Step 4:** pgTAP completo, db:types, typecheck → PASS.
- [ ] **Step 5: Commit** `feat(mcp): tracked links, automation results and contact listing`.

### Task 4: Meta — renovação do token e postbacks

**Files:** Create `supabase/migrations/20261027000003_meta_token_refresh.sql`, `supabase/tests/database/059_meta_token_refresh.test.sql`, `supabase/functions/meta-token-refresh/{index.ts,handler.ts}`, `supabase/functions/tests/meta-token-refresh.test.ts`; Modify `supabase/functions/meta-connection/handler.ts` (+ teste), `supabase/functions/tests/rpc-contract.test.ts`, `ops_health` (redefinir, última em `20261022000001`).

**Interfaces:**
- Produces:
  - Colunas `channels.access_token_expires_at timestamptz`, `channels.access_token_refreshed_at timestamptz`.
  - `public.meta_token_refresh_candidates() returns jsonb` (service-only): canais Instagram ativos com expiração nula ou < now()+15 dias e `access_token_refreshed_at` nula ou < now()−24 h → `[{channelId, generation, accessToken, apiVersion}]`.
  - `public.record_meta_token_refresh(p_channel uuid, p_generation int, p_token text, p_expires_in int, p_error text) returns void` (service-only): sucesso → `vault.update_secret` no mesmo id, expiração = now()+p_expires_in s, limpa erro; **não** incrementa `credential_generation`; geração diferente → ignora; erro (`token_refresh_failed`|`invalid_token`) → `last_error` da conexão.
  - `ops_health` inclui `tokenExpiresAt` e `tokenRefreshError` do canal.
  - Edge `meta-token-refresh`: segredo interno igual aos workers; `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` com o token no header `Authorization`; cron `flowai-meta-token-refresh` diário (`0 6 * * *`) via `net.http_post` no padrão de `dispatch_automation_worker`.
  - `meta-connection` assina `["messages","comments","messaging_seen","messaging_postbacks"]`.

- [ ] **Step 1: Testes que falham:** pgTAP (`candidates` filtra por prazo/idade; `record` grava no Vault sem mudar geração — `refresh_keeps_generation`; geração antiga ignorada; erro vai para `last_error`; authenticated → 42501). Deno com fetch simulado: renova e grava; 190 → `invalid_token`; timeout → `token_refresh_failed`; segredo interno inválido → 401; nenhum log contém o token. Teste do `meta-connection`: corpo da assinatura inclui `messaging_postbacks`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** pgTAP completo, testes edge (`deno test` conforme implementer-rules), db:types → PASS.
- [ ] **Step 5: Commit** `feat(meta): automatic Instagram token refresh and postback subscription`.

### Task 5: Web — OAuth 2.1 e contexto MCP

**Files:** Modify `supabase/config.toml` (`[auth.oauth_server] enabled = true`, `allow_dynamic_registration = true`, `authorization_url_path = "/oauth/consent"`); Create `apps/web/src/app/.well-known/oauth-protected-resource/route.ts` (e `…/oauth-protected-resource/mcp/route.ts`), `apps/web/src/app/oauth/consent/page.tsx` (+ ações), `apps/web/src/lib/mcp/context.ts`, testes ao lado.

**Interfaces:**
- Produces:
  - `GET /.well-known/oauth-protected-resource[/mcp]` → `{ resource: "<origin>/mcp", authorization_servers: ["<NEXT_PUBLIC_SUPABASE_URL>/auth/v1"], bearer_methods_supported: ["header"] }`.
  - `resolveMcpContext(request: Request): Promise<McpContext | Response>` com `type McpContext = { supabase: SupabaseClient<Database>; userId: string; orgId: string; role: "owner"|"admin"|"agent"|"viewer"; channel: { id: string; connectionId: string } | null; accessToken: string }`; sem/inválido → `Response 401` com `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`.
  - Consentimento: login obrigatório (redireciona ao login com retorno), mostra nome do cliente, "Permitir que o Claude gerencie suas automações do Instagram?", "Permitir"/"Recusar" via API de autorização OAuth do `@supabase/supabase-js` instalado (ler os tipos instalados e a doc oficial; atualizar a lib para versão exata ≥ 2 semanas se a API não existir).

- [ ] **Step 1: Testes que falham:** metadados corretos; `rejects_missing_token`, `rejects_invalid_token`, `rejects_user_without_org` (401/403 com `WWW-Authenticate`); contexto resolve organização e canal Instagram ativo; consentimento sem login redireciona; aprovar/recusar chamam a API certa (Supabase simulado).
- [ ] **Step 2:** `npm run test -w apps/web -- mcp oauth` → FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck + lint.
- [ ] **Step 5: Commit** `feat(mcp): OAuth protected resource metadata, consent screen and request context`.

### Task 6: Web — rota `/mcp` e ferramentas de leitura

**Files:** Create `apps/web/src/app/mcp/route.ts`, `apps/web/src/lib/mcp/server.ts`, `apps/web/src/lib/mcp/tools/{posts,automations-read,results,contacts}.ts`, `apps/web/src/lib/mcp/mcp.test.ts`; Modify `apps/web/package.json` (`@modelcontextprotocol/sdk` exato).

**Interfaces:**
- Consumes: `resolveMcpContext` (Task 5); `automation_results`, `mcp_contacts` (Task 3); ação `list_media` da Edge `meta-connection` (chamada com o JWT do usuário, `{ organizationId, connectionId, channelId, action: "list_media" }`).
- Produces:
  - `createMcpServer(ctx: McpContext): McpServer` registrando as ferramentas; `POST/GET/DELETE /mcp` com o transporte Streamable HTTP web-standard do SDK, sem sessão (`sessionIdGenerator: undefined`, respostas JSON), corpo ≤ 1 MB.
  - Ferramentas `listar_posts({limite?})`, `listar_automacoes({status?})`, `ver_resultados({automacaoId?, de?, ate?})`, `listar_contatos({busca?, automacaoId?, limite?})` conforme spec §3, cada uma com descrição pt-BR dizendo quando usar; saída `content` texto + `structuredContent`.
  - `type ToolResult` e helper `toolError(message: string)` (`isError: true`) reutilizados na Task 7.

- [ ] **Step 1: Testes que falham** (cliente `Client` do SDK com `StreamableHTTPClientTransport` cujo `fetch` chama o handler da rota diretamente; Supabase e Edge simulados): `lists_tools` (9 nomes previstos — os de escrita podem falhar até a Task 7, marque-os `todo`), `listar_posts_maps_media` (legenda cortada em 300), `listar_posts_without_channel` (erro "Nenhuma conta do Instagram conectada"), `ver_resultados_defaults_to_7_days`, `ver_resultados_rejects_91_days`, `listar_contatos_limits`, `unauthenticated_gets_401`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck + lint + `npm run build -w apps/web` (memória permitindo).
- [ ] **Step 5: Commit** `feat(mcp): streamable HTTP endpoint and read tools`.

### Task 7: Web — ferramentas de escrita

**Files:** Create `apps/web/src/lib/mcp/tools/automations-write.ts`, testes em `mcp.test.ts`.

**Interfaces:**
- Consumes: `automationSpecSchema`, `specToGraph`, `mergeSpec`, `summarizeSpec` (Task 1); `save_mcp_automation` (Task 2); `activate_automation`, `pause_automation`, `delete_automation`; `toolError` (Task 6).
- Produces: `criar_automacao(spec + {ativar?=true})`, `editar_automacao({id, alteracoes, confirmarSobrescrever?})`, `pausar_automacao({id})`, `ativar_automacao({id})`, `excluir_automacao({id, confirmar})` com resumo pt-BR + dados estruturados.

- [ ] **Step 1: Testes que falham:** `creates_and_activates` (resumo contém nome, gatilho, palavras, post e "ativa"); `create_validation_error_in_portuguese`; `create_requires_admin` (agent → erro claro); `edit_partial_merges`; `edit_invalid_patch_changes_nothing`; `edit_panel_modified_requires_confirmation`; `edit_panel_created_refused`; `pause_activate_summaries`; `delete_requires_confirm`; `warns_overlap` (outra automação ativa com mesmo gatilho/palavra/post é citada no resumo de criar e ativar); `post_must_belong_to_account` (post fora de `list_media` → erro).
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** PASS + typecheck + lint.
- [ ] **Step 5: Commit** `feat(mcp): write tools for automations`.

### Task 8: Web — `/r/[code]` e números no painel

**Files:** Create `apps/web/src/app/r/[code]/route.ts` (+ página de link inválido) e teste; Modify `apps/web/src/components/automation/automation-list.tsx` (+ query) e teste.

**Interfaces:**
- Consumes: `open_tracked_link` (cliente anon), `automation_results` (Task 3), `mcp_spec` (Task 2).
- Produces: `GET /r/<code>` → `302 Location: <url>` com `Cache-Control: no-store` e `Referrer-Policy: no-referrer`; código inválido → 404 "Link inválido". Lista com status, gatilho, selo "Criada pelo Claude" e disparos/cliques/contatos de 7 dias.

- [ ] **Step 1: Testes que falham:** `redirects_known_code`, `invalid_code_404` (`../x`, 200 caracteres, inexistente), `no_open_redirect` (só a URL vinda do banco); lista mostra números e selo.
- [ ] **Step 2–4:** FAIL → implementar → PASS + typecheck + lint.
- [ ] **Step 5: Commit** `feat(mcp): tracked link redirect and automation numbers`.

### Task 9: Documentação e verificação completa

**Files:** Create `docs/superpowers/mcp-setup.md`; Modify `README.md`, `docs/superpowers/instagram-setup.md` (postbacks, renovação).

- [ ] **Step 1:** `mcp-setup.md` com: cadastro do conector no Claude (URL `https://flowai-web-rust.vercel.app/mcp`, "Sign in now", identidade publicada do Claude), ativação do servidor OAuth e do registro dinâmico no painel Supabase com o caminho `/oauth/consent` e a URL do site, deploy das migrations e Edge Functions (`meta-token-refresh` incluída) na ordem worker → migration → push, checklist Meta (3 permissões, webhook `messages`/`comments`/`messaging_seen`/`messaging_postbacks`, token longo, URL e verify token), variáveis de ambiente, roteiro do teste real (comentar → resposta pública + DM → botão → link → follow-up → `ver_resultados`).
- [ ] **Step 2:** Rodar todas as suítes: core, web, scripts, pgTAP, edge, typecheck, lint, e2e padrão (`FLOWAI_E2E_SLOW_HOST=1`, RAM livre ≥ 600 MB). Expected: tudo PASS; registrar números.
- [ ] **Step 3: Commit** `docs(mcp): setup guide and verification`.
