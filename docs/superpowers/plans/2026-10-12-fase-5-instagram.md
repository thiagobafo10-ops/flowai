# Instagram Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** conectar Instagram profissional ao Inbox e responder por Direct a comentários com palavra-chave, com isolamento entre empresas.

**Architecture:** domínio puro e providers com fetch injetado em core; Edge Functions para credenciais, webhooks e envios; SQL transacional para deduplicação, intents e fila. Next mantém sessão e interface sem chave privilegiada. Uma conexão de app pertence a uma organização.

**Tech Stack:** stack instalada: Next.js 16, React, TypeScript, Supabase PostgreSQL/Vault/pgmq/pg_cron/Edge Functions Deno, Vitest, pgTAP e Playwright; npm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-12-fase-5-meta-design.md` (aprovada em 2026-10-12).

## Global Constraints

- Somente Instagram; WhatsApp não recebe provider nem configuração nesta etapa.
- Contas profissionais e Instagram Login; configuração manual, sem OAuth nesta fase.
- Nenhuma chave privilegiada do Supabase entra em `apps/web`.
- Tokens e segredos no Vault; helpers exclusivos do serviço e sem valores secretos em logs.
- App ID único na instalação, vínculo imutável à organização; callback por conexão.
- Corpo bruto assinado antes do parse; 200 somente após persistência durável.
- Uma resposta privada por comentário; comentário não abre janela normal de mensagens.
- Não repetir automaticamente envio com aceitação incerta; estados comprovados não regridem.
- Regra mais antiga ativa vence; frase completa, sem diferenciar maiúsculas e acentos.
- Eventos operacionais por 30 dias; trabalho pendente não é removido; histórico permanece.
- Transporte falso somente nos testes. Validação ao vivo é relatada separadamente.
- Antes de código Next, ler os guias pertinentes em `apps/web/node_modules/next/dist/docs/` ou no caminho resolvido do pacote instalado.

## Review Focus

1. Webhook duplicado/parcialmente persistido: repetir lote não duplica contatos, mensagens ou respostas (tarefas 3/5).
2. Conta/app de outra organização: credenciais e destinatários não podem ser aproveitados por outro tenant (tarefas 2/4/6).
3. Timeout após Graph aceitar envio: lease vencido não gera segunda mensagem (tarefas 3/6).
4. Regra editada/desativada após receber comentário: não executar texto novo nem ativação retroativa (tarefas 3/7).
5. Entrega antes do external ID e eventos atrasados: reconciliar sem perder ou rebaixar estado (tarefas 3/5).

## Estrutura e fronteiras

- `packages/core/src/channels/instagram/`: tipos de eventos, schemas, parser, provider, erros e testes; exportar via channels/index.ts e src/index.ts.
- `packages/core/src/channels/meta-signature.ts`: assinatura raw body; `comment-keyword.ts`: comparação de regra.
- `supabase/migrations/20261012000001_meta_connections.sql`: conexões/Vault/grants; `...000002_instagram_events.sql`: eventos, intents, regras e fila; `...000003_instagram_worker.sql`: agendamento/limpeza.
- `supabase/functions/_shared/`: autenticação, repositório Meta e configuração de runtime, sem importar Next.
- `supabase/functions/{meta-connection,meta-webhook,send-message,instagram-worker}/`: entradas pequenas; cada handler exportável recebe dependências para testes.
- `apps/web/src/lib/instagram/`: actions/queries; `apps/web/src/components/settings/instagram/`: configuração e regras.
- `apps/web/src/lib/inbox/actions.ts`: escolher transporte por canal; componentes de mensagens mostram contexto e resultado incerto.
- `supabase/tests/database/023_meta_connections.test.sql`, `024_instagram_events.test.sql`, `025_instagram_worker.test.sql`; `supabase/functions/tests/`; `apps/web/e2e/instagram.spec.ts`.

## Task 1: contrato Instagram e domínio testável

**Files:** criar `docs/superpowers/instagram-contracts.md`, `packages/core/src/channels/instagram/{types,schemas,parse,provider,errors}.ts`, `instagram.test.ts`, `meta-signature.ts`, `meta-signature.test.ts`, `comment-keyword.ts`, `comment-keyword.test.ts`; modificar exports core.

**Interfaces:** `InstagramEvent` é união discriminada `message | comment | status | ignored` com accountId, externalId, occurredAt; mensagem traz senderExternalId/text/context, comentário traz commentId/mediaId/senderExternalId/text, status traz messageExternalId/state. `InstagramProvider({accountId,accessToken,apiVersion,fetch,now})` implementa ChannelProvider e `sendPrivateReply(commentId:string,text:string):Promise<{externalId:string;recipientId:string}>`. Exportar `parseInstagramEvents(raw:unknown):InstagramEvent[]`, `verifyMetaSignature(body:Uint8Array,signature:string|null,secret:string):Promise<boolean>` e `matchesCommentKeyword(text:string,keyword:string):boolean`.

- [ ] Conferir contratos oficiais e registrar URL/data/versão, scopes, subscrições, formato de stories/echo/read/comment, janela e limite de texto, perfil/teste de token e endpoint de private reply. Não adotar exemplos de Facebook Login para Instagram Login; registrar indisponibilidade como bloqueio da capacidade afetada.
- [ ] Escrever testes com fixtures provenientes dos contratos: `expect(parseInstagramEvents(batch)).toMatchObject([...])`; ignorar echo e tipo desconhecido; assinatura muda se um byte do corpo muda; `matchesCommentKeyword('QUERO o guia','guia') === true` e `matchesCommentKeyword('guiado','guia') === false`; fetch de private reply usa comment ID, não user ID; erros não expõem token.
- [ ] Rodar `npm run test -w @flowai/core -- instagram meta-signature comment-keyword`; confirmar falhas por exports ausentes.
- [ ] Implementar interfaces e validações, com limites verificados no contrato; usar AbortSignal/timeout e erros tipados (rejected/uncertain) sem incluir resposta sensível. Preservar contrato do simulador.
- [ ] Repetir os testes, rodar typecheck core e revisar fixtures/versão; todos devem passar. Commit `feat(instagram): add provider and verified webhook contracts`.

## Task 2: conexões e Vault protegidos

**Files:** migration 001, test 023, database.types.ts.

**Interfaces:** tabela `meta_connections` com id/org/app_id/api_version, secret IDs e verificação; channels.meta_connection_id. RPCs service-only `save_instagram_connection(p_actor_id uuid,p_org_id uuid,p_input jsonb) returns jsonb`, `read_meta_connection_secrets(p_connection_id uuid) returns jsonb`, `set_meta_connection_verification(p_connection_id uuid,p_kind text,p_success boolean,p_error_code text) returns void`. Primeiro RPC valida admin/owner no banco, retorna somente IDs e metadata segura.

- [ ] Escrever pgTAP: anon/agente não podem ler Vault nem executar helpers; owner de outra empresa não pode salvar; app ID duplicado falha; canal não pode apontar conexão de outro tenant; grant de UPDATE direto não permite ativar Instagram ou alterar vínculo; erro rollback não deixa segredo órfão.
- [ ] Rodar `npm run db:reset` e `npm run db:test`; confirmar falhas nas novas asserções.
- [ ] Criar schema/grants/Vault helpers e FKs compostas; restringir UPDATE de status existente para exigir RPC de simulador ou Meta verificada. Adaptar `setSimulatorActive`/criação do simulador e suas regressões neste mesmo commit, preservando comportamento.
- [ ] Regenerar tipos com `npm run db:types`; repetir pgTAP e testes de canais existentes; commit `feat(instagram): secure connection credentials and activation`.

## Task 3: eventos, intents e regras transacionais

**Files:** migration 002, test 024, database.types.ts.

**Interfaces:** `ingest_instagram_event(p_connection_id uuid,p_event jsonb) returns jsonb` (service-only); `create_instagram_send_intent(p_conversation_id uuid,p_text text,p_request_id uuid) returns uuid` (authenticated, checa role/tenant); `claim_instagram_send(p_intent_id uuid) returns jsonb`, `complete_instagram_send(p_intent_id uuid,p_result jsonb) returns void` (service-only). Tabelas `instagram_events`, `instagram_send_intents`, `instagram_comment_rules`; eventos guardam rule_id/version selecionada e status de processamento. RPC `save_instagram_comment_rule(p_input jsonb) returns uuid` valida owner/admin e incrementa versão. Queue `instagram_work` apenas para trabalho desta fase; eventos futuros permanecem com destino separado.

- [ ] Escrever pgTAP cobrindo cada item de Review Focus: duplicate retorna mesmo resultado; ingestão e enqueue rollback juntos; claim concorrente retorna uma vez; claim vencido após envio iniciado vira incerto; regra nova não captura evento antigo; evento status anterior ao external ID reconcilia após complete; read seguido de sent permanece read.
- [ ] Rodar reset/db:test e confirmar falhas.
- [ ] Implementar ingestão usando função existente de contato/conversa para Direct, contexto em mensagens e intents sem inbound falso para comentário. Regras selecionadas por created_at/id, snapshot version, sem processamento de self-comment. Dedup e enqueue na mesma transação. Restringir service-only grants; RLS de histórico e regras scoped à organização. Só completar com resultado de intenção reivindicada.
- [ ] Regenerar tipos; reset/db:test devem passar; commit `feat(instagram): persist idempotent events and send intents`.

## Task 4: configuração autenticada

**Files:** `_shared/{auth,meta-repository}.ts`, `meta-connection/{index,handler}.ts`, `functions/tests/meta-connection.test.ts`, config.toml e configuração Deno mínima dentro de functions.

**Interfaces:** `handleMetaConnection(request:Request,deps:MetaConnectionDeps):Promise<Response>`; ações `save | test | reveal_verify_token | disconnect`. `MetaConnectionDeps` fornece autenticação de JWT, repositório e fetch; auth resolve usuário com Supabase Auth e role no banco. Verificação de conta retorna account ID/scopes seguros, sem token.

- [ ] Escrever testes Deno para JWT inválido, usuário removido/admin de outro tenant, conta retornada diferente, reveal sem cache, token expirado, disconnect preservando histórico e nenhuma credencial na resposta/log.
- [ ] Rodar `deno test --allow-env --allow-read supabase/functions/tests/meta-connection.test.ts`; confirmar falhas. Se Deno não estiver disponível, usar runtime Edge local para os mesmos testes antes de considerar verificado.
- [ ] Implementar handler/entrypoint, timeout e códigos seguros. Ativar canal somente quando token e webhook verificados; rotação invalida verificações afetadas. Gateway não substitui validação de usuário no handler.
- [ ] Repetir testes e typecheck Deno; commit `feat(instagram): add secure connection management`.

## Task 5: webhook assinado e reconciliação

**Files:** `meta-webhook/{index,handler}.ts`, `functions/tests/meta-webhook.test.ts`, config.toml.

**Interfaces:** `handleMetaWebhook(request:Request,deps:MetaWebhookDeps):Promise<Response>` usa parser/assinatura da tarefa 1 e ingest RPC da tarefa 3. Connection ID extraído somente da rota; rejeitar formato inválido sem consultar Vault. GET challenge e POST público autenticado por assinatura.

- [ ] Testar raw bytes/assinatura inválida, challenge incorreto, limite de 1 MiB (413), lote misto/duplicado, canal foreign, inactive ignorado, falha no segundo evento (503) e retry deduplicando primeiro. Testar estados fora de ordem e nenhum fetch externo no POST.
- [ ] Rodar `deno test --allow-env --allow-read supabase/functions/tests/meta-webhook.test.ts`; confirmar falhas.
- [ ] Implementar GET/POST, limite e rate limit antes de parsing; persistir lote antes do 200. Desabilitar verify_jwt somente nesta rota pública, mantendo HMAC obrigatória. Não persistir payload bruto.
- [ ] Repetir testes e callback HTTP local por `supabase functions serve`; commit `feat(instagram): ingest signed webhooks durably`.

## Task 6: envio do Inbox

**Files:** `send-message/{index,handler}.ts`, functions test de envio; inbox/actions.ts/actions.test.ts, schemas de texto/contexto e componentes de mensagem afetados.

**Interfaces:** `handleSendMessage(request:Request,deps:SendMessageDeps):Promise<Response>` recebe `{intentId:string}`; autentica usuário e tenant da intenção, claim/send/complete. Retorno `{state:'sent'|'failed'|'uncertain',messageId:string}`. Action de reply existente cria intent para Instagram e invoca Edge com JWT; simulador usa caminho existente. Destinatário Instagram é instagram_id.

- [ ] Testar duas invocações/um fetch, token de outro tenant, recipient arbitrário ignorado/rejeitado, janela fechada sem fetch, erro explícito versus timeout incerto e contato com telefone + Instagram escolhendo Instagram.
- [ ] Rodar testes core/web direcionados e `deno test --allow-env --allow-read supabase/functions/tests/send-message.test.ts`; confirmar falhas.
- [ ] Implementar rota/integração e texto de resultado incerto no Inbox; bloquear reenvio automático, notas não enviadas. Leitura local independe da confirmação remota; enqueue ack remoto só para Direct elegível.
- [ ] Repetir testes, `npm run typecheck`; commit `feat(instagram): send Inbox replies with safe delivery handling`.

## Task 7: worker de comentários e operação

**Files:** migration 003, test 025, `instagram-worker/{index,handler}.ts`, functions worker test.

**Interfaces:** `handleInstagramWorker(request:Request,deps:InstagramWorkerDeps):Promise<Response>` valida segredo interno; `processInstagramWork(item:InstagramWork,deps:InstagramWorkerDeps):Promise<WorkResult>` consome claim/complete da tarefa 3. `WorkResult = 'done'|'ignored'|'retry'|'failed'|'uncertain'`. RPCs service-only de read/archive/fail da fila não ficam abertos a authenticated.

- [ ] Testar um comentário/uma resposta, regra version alterada ou desativada não envia, comentário próprio ignorado, token invalidado entre ingest e worker, limite oficial expirado, timeout incerto sem retry, endpoint sem segredo 401 e limpeza preservando itens pendentes/histórico.
- [ ] Rodar testes Deno/pgTAP; confirmar falhas.
- [ ] Implementar worker com máximo de 5 tentativas apenas para falha confirmada anterior à aceitação, backoff 30/60/120/240 segundos; claim serializa. Configurar cron por minuto com pg_net e segredo Vault; não inserir chaves no texto da migration. Limpeza diária de eventos concluídos com mais de 30 dias. Eventos para IA futura não são consumidos nesta fila.
- [ ] Testar execução cron local, repetir suites específicas; commit `feat(instagram): process keyword replies and maintain event queues`.

## Task 8: canais e regras na interface

**Files:** lib/instagram/{actions,queries}.ts; components/settings/instagram/{connection-form,connection-card,comment-rules}.tsx; channels-settings.tsx; e2e/instagram.spec.ts; e2e/support/instagram.ts.

**Interfaces:** ações com ActionResult existentes: `saveInstagramConnection(input)`, `testInstagramConnection(id)`, `disconnectInstagramConnection(id)`, `saveCommentRule(input)`, `setCommentRuleActive(id,active)`. Queries selecionam colunas seguras explicitamente. Bridge para meta-connection usa JWT; regra usa RPC de usuário com RLS.

- [ ] E2E red: admin cadastra dados, estados token/webhook separados, segredo não reaparece ao reabrir, agente não acessa configuração, Instagram ingressa Inbox/CRM, Direct enviado, contexto story mostrado, regra desativada por padrão e precedência explicada. Testar frase acentuada e regra alterada enquanto evento aguarda worker.
- [ ] Rodar `npm run e2e -w @flowai/web -- instagram.spec.ts`; confirmar falhas.
- [ ] Implementar forms reutilizando UI existente; versão API obrigatória; sem botão funcional de WhatsApp. Não permitir "ativar" sem verificações. Transporte fake somente fixtures/harness, sem flag de bypass em produção.
- [ ] Repetir E2E, lint web e typecheck; conferir desktop/mobile; commit `feat(instagram): configure channels and keyword rules`.

## Task 9: regressão, revisão e documentação de entrega

**Files:** README.md, `docs/superpowers/fase-5-pendencias.md`, contratos/spec/plano, scripts necessários no package.json.

- [ ] Rodar reset/db:test, `npm test`, `npm run typecheck`, `npm run lint -w @flowai/web`, suite Edge completa e E2E completo; registrar resultados reais, sem reutilizar contagens da Fase 4.
- [ ] Executar callback assinado local → Inbox → reply → status e comentário → resposta privada única; confirmar isolamento usando duas organizações. Capturar telas desktop/mobile.
- [ ] Solicitar revisão do diff completo pelo fluxo da skill de execução; corrigir achados materiais e repetir somente os checks afetados.
- [ ] Documentar setup app profissional, scopes, versão, callback, segredo, cron e rotação; pendências de validação ao vivo separadas. Não enviar mensagens reais nem publicar sem autorização aplicável.
- [ ] Commit `docs(instagram): document setup and verified integration`; entregar evidências e limitações.

## Autorrevisão do plano

Cobertura: conexão/Vault (2/4), contratos (1), durabilidade/stories/status (3/5), Direct/leitura (6), regra/worker/retention (3/7), configuração/CRM/realtime (8), operação/regressão (9). Review Focus tem testes nas tarefas indicadas. Detalhes externos ainda não verificados são pré-requisito explícito da tarefa 1, não fatos assumidos. O schema existente e o simulador são preservados por regressões; mudanças de grants incluem ajuste dos callers.

## Handoff

Plano pronto para revisão. Método recomendado: execução nativa nesta sessão, por haver dependência sequencial forte entre SQL, Edge e Inbox, com revisão independente do conjunto ao final. Nenhuma implementação iniciada até a revisão do plano, conforme writing-plans.
