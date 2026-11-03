# E-mails da loja — Etapa 1 (base + carrinho abandonado) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receber os eventos do checkout Yampi e enviar pelo Resend a jornada "Carrinho abandonado" (3 e-mails com a marca da loja), que para sozinha quando a pessoa compra ou se descadastra, com painel de configuração, histórico e vendas recuperadas.

**Architecture:** `yampi-webhook` (Edge) valida o HMAC e entrega um evento normalizado (parser puro em `packages/core`) à RPC `ingest_yampi_event`, que cria/acha o contato pelo e-mail, grava carrinho/pedido e agenda `email_sends`. Um cron de minuto chama `email-worker`, que reserva os envios vencidos (a RPC revalida e cancela), monta o HTML (template puro em `packages/core`) e chama o Resend. `resend-webhook` registra entrega/abertura/clique/devolução. Tela nova em Configurações → "E-mails da loja"; descadastro público em `/e/sair/<token>`.

**Tech Stack:** Next 16 (App Router), React 19, Zod 4, Vitest; Supabase Postgres (plpgsql, Vault, pg_cron, pg_net, pgTAP); Edge Functions Deno 2; Resend REST API.

**Spec:** `docs/superpowers/specs/2026-11-03-emails-da-loja-design.md` (esta é a etapa 1 da seção "Etapas de entrega").

## Global Constraints

- Nenhum teste chama Yampi ou Resend de verdade.
- Segredos (chave Resend, segredo do webhook Yampi, segredo do webhook Resend) só no Vault; chave de serviço nunca em `apps/web`; nunca registrar chave nem corpo de e-mail em log.
- Tudo por organização, com RLS; escrita exige admin/owner (`public.has_role(p_org,'admin')`), leitura `public.is_member`.
- Yampi: assinatura no cabeçalho `X-Yampi-Hmac-SHA256` = base64(HMAC-SHA256(corpo bruto, segredo do webhook)); responder 2xx em menos de 5 s.
- Jornada `cart` padrão: passos em 60, 1440 e 2880 minutos; categoria `marketing`; o 3º passo traz `coupon` vazio para o usuário preencher.
- Envio idempotente: `email_sends` único em `(step_id, cart_id)`; Resend chamado com `Idempotency-Key: <email_send.id>`.
- Novas tentativas: até 3, esperas de 5, 15 e 60 minutos; 4xx de validação → falha definitiva.
- Venda recuperada: `order.paid` do mesmo contato até 7 dias depois de um envio `sent` da jornada `cart`, atribuída ao último envio.
- Textos de interface em português; variáveis `{primeiro_nome}`, `{nome}`, `{cupom}`, `{valor}`, `{loja}`; variável sem valor vira vazio.
- Ramo: `feat/emails-da-loja`.

## Rulings já tomadas no plano (a partir da documentação da Yampi lida em 2026-11-03)

- **Sem foto no carrinho:** o `cart.reminder` da Yampi não traz imagem dos itens. Nesta etapa o bloco de produtos mostra nome, variante, quantidade e preço; o template já aceita `imageUrl` opcional para quando houver. Buscar fotos (API de produtos da Yampi ou Shopify por SKU) fica fora desta etapa.
- **Link de recuperação:** `resource.simulate_url` do carrinho; se ausente, `https://<loja>` não é inventado — o passo é cancelado com `no_recovery_url`. Confirmado no teste real (Tarefa 8).
- **Cliques:** pelo rastreio de cliques do próprio Resend (evento `email.clicked`), não por `/r/` — `tracked_links` exige automação e execução, e mudar isso não traz ganho nesta etapa.
- **E-mails da própria Yampi:** o payload de carrinho traz `emails.data[]` (recuperação nativa). O guia manda desligá-la; o FlowAI não tenta detectar.

## Review Focus

- `cart.reminder` repetido para o mesmo carrinho (a Yampi reenvia a cada lembrete dela) → um só agendamento por passo (Task 3, teste "reminder twice").
- Pessoa paga entre o agendamento e o envio → envio cancelado com `paid`, nunca enviado (Task 3, teste "paid cancels").
- Texto com `<script>` ou `&` vindo da Yampi ou do usuário → escapado no HTML (Task 2, teste "escapes").
- Corpo assinado com espaços/ordem diferente do JSON re-serializado → validar sobre os **bytes brutos** recebidos (Task 4, teste "raw body").
- Contato do Instagram sem e-mail e cliente Yampi com e-mail novo → cria contato novo, nunca mescla por nome (Task 3, teste "no merge by name").

---

### Task 1: Parser dos eventos Yampi (core, puro)

**Files:**
- Create: `packages/core/src/store/yampi.ts`, `packages/core/src/store/yampi.test.ts`, `packages/core/src/store/fixtures/yampi-cart-reminder.json`, `packages/core/src/store/fixtures/yampi-order-paid.json`
- Modify: `packages/core/src/index.ts` (exportar)

**Interfaces:**
- Produces:
  ```ts
  type StoreItem = { name: string; variant: string | null; quantity: number; price: number; imageUrl: string | null };
  type StoreCustomer = { email: string | null; name: string | null; phone: string | null };
  type YampiEvent =
    | { kind: "cart"; event: "cart.reminder"; merchantAlias: string; customer: StoreCustomer;
        cart: { externalId: string; token: string | null; total: number; recoveryUrl: string | null; items: StoreItem[] } }
    | { kind: "order"; event: "order.created" | "order.paid" | "order.status.updated"; merchantAlias: string; customer: StoreCustomer;
        order: { externalId: string; number: string; statusAlias: string | null; paymentAlias: string | null; total: number;
                 cartToken: string | null; paid: boolean; items: StoreItem[]; trackCode: string | null; trackUrl: string | null } }
    | { kind: "ignored"; event: string };
  function parseYampiEvent(raw: unknown): YampiEvent;          // lança em formato inválido de evento conhecido
  async function verifyYampiSignature(body: Uint8Array, header: string | null, secret: string): Promise<boolean>;
  ```
- Caminhos (doc Yampi): `event`, `merchant.alias`, `resource.id`, `resource.token`, `resource.totalizers.total`, `resource.simulate_url`, `resource.customer.data.{email,name,phone.full_number}`, itens em `resource.items.data[]` com `quantity`, `price`, `sku.data.title`; pedido: `resource.number`, `resource.status.data.alias`, `resource.payments[0].alias`, `resource.value_total`, `resource.cart_token`, `resource.track_code`, `resource.track_url`. `paid = event === "order.paid"`. E-mail: minúsculo e aparado; inválido → `null`. Textos cortados (nome 200, título 200).

- [ ] **Step 1: Fixtures** — copiar os exemplos de `cart.reminder` e `order.*` da documentação de webhooks da Yampi (`docs.yampi.com.br/api-reference/introduction-webhook`) para os dois JSON, trocando dados pessoais por fictícios.
- [ ] **Step 2: Testes que falham** (`yampi.test.ts`):
  - `parses cart.reminder`: fixture → `kind: "cart"`, `externalId` = `String(resource.id)`, `recoveryUrl` = `simulate_url`, `items[0]` com `name`, `quantity`, `price`, `imageUrl: null`, e-mail em minúsculas.
  - `parses order.paid`: fixture com `event` trocado para `order.paid` → `paid: true`, `number`, `paymentAlias`, `cartToken`.
  - `ignores unknown events`: `{ event: "product.updated", resource: {} }` → `{ kind: "ignored", event: "product.updated" }`.
  - `invalid email becomes null`: `customer.data.email = "sem-arroba"` → `customer.email === null`.
  - `rejects known event without resource.id`: lança.
  - `verifies signature over raw bytes`: corpo `'{"a": 1}'` (com espaço), segredo `"s3cr3t"`, cabeçalho = base64 do HMAC calculado no teste com `crypto.subtle` → `true`; mesmo cabeçalho com corpo `'{"a":1}'` → `false`; cabeçalho `null` → `false`.
- [ ] **Step 3:** `npx vitest run packages/core/src/store` → FAIL.
- [ ] **Step 4:** Implementar com Zod (`passthrough`, só os campos usados) e `crypto.subtle` (comparação em tempo constante, como `verifyMetaSignature` em `packages/core/src/channels/meta-signature.ts`).
- [ ] **Step 5:** `npx vitest run packages/core` → PASS. Commit `feat(core): parser e assinatura dos webhooks da Yampi`.

### Task 2: Template do e-mail (core, puro)

**Files:**
- Create: `packages/core/src/email/template.ts`, `packages/core/src/email/template.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `StoreItem` (Task 1).
- Produces:
  ```ts
  type EmailContent = { subject: string; heading: string; body: string; buttonLabel: string; coupon: string | null };
  type EmailContext = { storeName: string; firstName: string | null; name: string | null; total: number | null;
                        items: StoreItem[]; buttonUrl: string; unsubscribeUrl: string | null };
  function renderEmail(content: EmailContent, ctx: EmailContext): { subject: string; html: string; text: string };
  function fillVariables(text: string, ctx: EmailContext & { coupon: string | null }): string;
  export const DEFAULT_CART_STEPS: readonly (EmailContent & { delayMinutes: number })[];  // 3 passos: 60, 1440, 2880
  ```
- HTML: tabelas, estilos inline, largura 600, cores da marca (`#0E0E0E`, `#F4F2EE`, acento `#E8458B`), fonte do sistema com fallback; até 4 itens (+ "e mais N itens"); cupom em caixa destacada só se houver; rodapé com `storeName` e, se `unsubscribeUrl`, link "Não quero mais receber estes e-mails". `{valor}` formatado `R$ 89,90` (pt-BR).

- [ ] **Step 1: Testes que falham:**
  - `fills variables`: `"Oi, {primeiro_nome}! Cupom {cupom} na {loja}. Total {valor}"` com `firstName "Ana"`, `coupon "CUPOM20"`, `storeName "Holy Spirit"`, `total 89.9` → `"Oi, Ana! Cupom CUPOM20 na Holy Spirit. Total R$ 89,90"`.
  - `missing variable is empty`: sem nome, `"Oi, {primeiro_nome}!"` → `"Oi!"` (remove a vírgula e o espaço órfãos antes da variável) e `"{primeiro_nome}, volte"` → `"Volte"` (remove vírgula/espaço órfãos depois e põe a primeira letra em maiúscula); variável desconhecida `{xyz}` fica como está.
  - `escapes`: `heading "<script>x</script> & cia"` → HTML contém `&lt;script&gt;` e `&amp; cia`, não contém `<script>`.
  - `items cap`: 6 itens → 4 nomes no HTML e `"e mais 2 itens"`.
  - `coupon box only with coupon`: sem cupom → HTML não contém o rótulo `"Seu cupom"`; com cupom → contém `CUPOM20`.
  - `unsubscribe footer`: com `unsubscribeUrl` → contém o link; sem → não contém `"Não quero mais"`.
  - `text version`: `text` contém título, corpo, `buttonUrl` e, se houver, o cupom.
  - `default cart steps`: `DEFAULT_CART_STEPS.map(s => s.delayMinutes)` = `[60, 1440, 2880]`; o 3º tem `coupon: ""`.
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar (textos padrão em português, curtos, tom da marca; o 1º lembra o carrinho, o 2º reforça, o 3º oferece o cupom). **Step 4:** PASS + `npx tsc -p packages/core --noEmit`. **Step 5:** Commit `feat(core): template de e-mail da loja`.

### Task 3: Banco — tabelas, entrada Yampi, agendamento e cancelamento

**Files:**
- Create: `supabase/migrations/20261104000001_store_emails.sql`, `supabase/tests/database/061_store_emails_ingest.test.sql`

**Interfaces:**
- Consumes: forma de `YampiEvent` (Task 1) como `jsonb` (`kind`, `event`, `customer`, `cart`/`order`), mais `bodyHash` (hex do SHA-256 do corpo, calculado na Edge).
- Produces (tabelas, todas com `organization_id` + RLS select `is_member`, sem escrita direta por `authenticated`):
  - `store_connections(id uuid pk, organization_id uuid unique, merchant_alias text, webhook_secret_id uuid, created_at)`.
  - `store_events(id, organization_id, connection_id, event text, resource_id text, body_hash text, received_at, unique(connection_id, event, resource_id, body_hash))`.
  - `store_carts(id, organization_id, connection_id, external_id text, token text, contact_id → contacts on delete cascade, total numeric(12,2), recovery_url text, items jsonb, converted_at timestamptz, created_at, updated_at, unique(connection_id, external_id))`.
  - `store_orders(id, organization_id, connection_id, external_id, number text, contact_id → contacts on delete cascade, status_alias, payment_alias, total numeric(12,2), cart_token text, items jsonb, paid_at, track_code, track_url, created_at, updated_at, unique(connection_id, external_id))`.
  - `email_journeys(id, organization_id, kind check in ('cart','pending_payment','post_purchase'), enabled bool default false, unique(organization_id, kind))`.
  - `email_journey_steps(id, organization_id, journey_id → on delete cascade, position int check 1..10, delay_minutes int check 1..43200, enabled bool default true, subject text 1..150, heading text 0..150, body text 1..3000, button_label text 1..40, coupon text 0..40 default '', category check in ('marketing','transactional'), unique(journey_id, position))`.
  - `email_sends(id, organization_id, contact_id → contacts on delete cascade, step_id → steps on delete cascade, cart_id → store_carts on delete cascade, order_id → store_orders on delete cascade, to_email text, send_at timestamptz, state check in ('scheduled','sending','sent','cancelled','failed'), cancel_reason text, claimed_at, attempts int default 0, provider_id text unique, sent_at, delivered_at, opened_at, clicked_at, bounced_at, error_code text, created_at, unique(step_id, cart_id))`.
  - `email_suppressions(organization_id, email text, reason text, created_at, primary key(organization_id, email))`.
  - `contacts.email_marketing_opt_out_at timestamptz` (nova coluna).
  - RPC (só `service_role`): `public.ingest_yampi_event(p_connection uuid, p_event jsonb, p_body_hash text) returns jsonb` → `{"state": "duplicate" | "ignored" | "processed"}`.
  - RPC (só `service_role`): `public.read_yampi_connection(p_connection uuid) returns jsonb` → `{"organizationId","secret"}` ou `null`.
  - Helper: `private.contact_for_email(p_org uuid, p_email text, p_name text, p_phone text) returns uuid`.
  - RPC (authenticated, admin): `public.save_store_connection(p_org uuid, p_alias text, p_secret text) returns uuid` (cria ou atualiza; segredo no Vault como `flowai-yampi-<id>-secret`).
  - RPC (authenticated, admin): `public.set_email_journey_enabled(p_org uuid, p_kind text, p_enabled boolean) returns uuid` — cria a jornada com os passos padrão de `cart` na primeira vez (mesmos valores de `DEFAULT_CART_STEPS`, inseridos pelo SQL) e devolve o id.
  - RPC (authenticated, admin): `public.save_email_journey_step(p_org uuid, p_step uuid, p_input jsonb) returns void` (campos editáveis: `delayMinutes`, `enabled`, `subject`, `heading`, `body`, `buttonLabel`, `coupon`).

Regras do `ingest_yampi_event`:
- insere em `store_events`; conflito → `duplicate`.
- `customer.email` nulo → `ignored` (evento guardado, nada agendado).
- `cart`: upsert do carrinho; se o carrinho ainda não tem envios **e** não está convertido **e** a jornada `cart` está ligada, cria um `email_sends` por passo ligado com `send_at = now() + delay`.
- `order`: upsert do pedido; se `cart_token` casa com `store_carts.token` → `converted_at = now()` no carrinho e cancela seus envios `scheduled` com `converted`; se `paid` → `paid_at`, e cancela todos os envios `scheduled` da jornada `cart` do mesmo contato com `paid`.

- [ ] **Step 1: pgTAP que falha** (`061_store_emails_ingest.test.sql`, fixtures no padrão de `056_comment_public_reply.test.sql`: `tests.create_user`, `tests.create_org`, `tests.authenticate_as`):
  1. `save_store_connection` por membro não-admin → `42501`; por admin → id; `read_yampi_connection` devolve o segredo; `authenticated` não executa `read_yampi_connection`.
  2. `set_email_journey_enabled(org,'cart',true)` cria 3 passos com delays `{60,1440,2880}`.
  3. evento cart com e-mail `Ana@Ex.com` → contato novo com e-mail `ana@ex.com`; 3 `email_sends` `scheduled` com `send_at` ≈ `now()+60min/1440/2880`.
  4. **reminder twice**: mesmo carrinho, outro `body_hash` → continua 3 envios.
  5. mesmo evento e mesmo `body_hash` → `duplicate`.
  6. **no merge by name**: contato existente sem e-mail com o mesmo nome → novo contato criado; contato existente com o mesmo e-mail → reaproveitado.
  7. jornada desligada → carrinho gravado, 0 envios.
  8. `order.created` com `cartToken` do carrinho → envios `cancelled`/`converted`, `converted_at` preenchido.
  9. **paid cancels**: outro carrinho do mesmo contato com envios agendados + `order.paid` de outro pedido → envios `cancelled`/`paid`.
  10. e-mail ausente → `ignored`, 0 envios.
  11. RLS: membro de outra organização não vê `store_carts`, `email_sends`.
- [ ] **Step 2:** `npx supabase test db` (Docker ligado) → FAIL nos novos.
- [ ] **Step 3:** Escrever a migração (seguir `20261027000003_meta_token_refresh.sql` para Vault e grants: `revoke all ... from public, anon, authenticated` e `grant execute ... to service_role` / `authenticated` conforme a lista acima).
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db` → tudo PASS. Regenerar `packages/core/src/db/database.types.ts` com o comando já usado no repo (`npx supabase gen types typescript --local`), conferir que `npx tsc` dos pacotes continua limpo.
- [ ] **Step 5:** Commit `feat(db): carrinhos, pedidos e agendamento da jornada de carrinho`.

### Task 4: Edge `yampi-webhook`

**Files:**
- Create: `supabase/functions/yampi-webhook/handler.ts`, `supabase/functions/yampi-webhook/index.ts`, `supabase/functions/tests/yampi-webhook.test.ts`
- Modify: `supabase/config.toml` (bloco `[functions.yampi-webhook]` com `verify_jwt = false`, como o `meta-webhook`)

**Interfaces:**
- Consumes: `parseYampiEvent`, `verifyYampiSignature` (Task 1); RPCs `read_yampi_connection`, `ingest_yampi_event` (Task 3).
- Produces: `handleYampiWebhook(request: Request, deps: { readConnection(id: string): Promise<{ organizationId: string; secret: string } | null>; allowIp(ip: string): Promise<boolean>; ingest(id: string, event: YampiEvent, bodyHash: string): Promise<unknown> }): Promise<Response>`.
- Rota `/yampi-webhook/<uuid>`; só `POST`; corpo ≤ 1 MB (`readLimitedBody` de `_shared/http.ts`); `clientIp` e limite por IP como em `meta-webhook/handler.ts`.

- [ ] **Step 1: Testes que falham:** assinatura válida → 200 e `ingest` chamado uma vez com `kind: "cart"`; **raw body** (assinatura do corpo com espaços extras) → 200; assinatura inválida → 401 sem `ingest`; conexão desconhecida → 404; `GET` → 405; evento desconhecido válido → 200 sem `ingest`; corpo inválido de evento conhecido → 400; erro do banco → 503.
- [ ] **Step 2:** `npm run test:edge -- --filter yampi` → FAIL. **Step 3:** Implementar (`bodyHash` = hex do SHA-256 do corpo bruto). **Step 4:** `npm run test:edge` → PASS. **Step 5:** Commit `feat(edge): webhook da Yampi`.

### Task 5: Banco — reserva, conclusão, supressão, descadastro, resultados e cron

**Files:**
- Create: `supabase/migrations/20261104000002_email_worker.sql`, `supabase/tests/database/062_email_worker.test.sql`

**Interfaces:**
- Consumes: tabelas da Task 3.
- Produces:
  - `email_settings(organization_id pk, from_name text 1..100, from_email text, reply_to text, resend_key_secret_id uuid, resend_webhook_secret_id uuid, domain_status text, updated_at)` + RLS select membro (sem ids de segredo expostos: view ou colunas revogadas).
  - `email_unsubscribe_tokens(token text pk default encode(gen_random_bytes(24),'hex'), organization_id, contact_id unique → contacts on delete cascade)`.
  - `public.save_email_settings(p_org uuid, p_input jsonb) returns void` (admin; `resendKey` e `resendWebhookSecret` opcionais — ausentes mantêm os atuais; Vault `flowai-email-<org>-resend`/`-webhook`).
  - `public.claim_email_sends(p_limit int) returns jsonb` (service_role): reserva até `p_limit` envios `scheduled` com `send_at <= now()` (e `sending` com `claimed_at` > 5 min), `for update skip locked`; para cada um revalida e cancela com `step_disabled` (jornada ou passo desligado), `paid`, `converted`, `unsubscribed` (`email_marketing_opt_out_at` e categoria `marketing`), `suppressed`, `no_email`, `no_recovery_url`, `no_settings` (sem `email_settings`/chave); devolve só os válidos como `[{sendId, toEmail, category, content:{subject,heading,body,buttonLabel,coupon}, ctx:{storeName, firstName, name, total, items, buttonUrl, unsubscribeToken}, from, replyTo, resendKey}]` (`storeName` = `from_name`; `buttonUrl` = `recovery_url`; `unsubscribeToken` só em marketing, criado se não existir).
  - `public.complete_email_send(p_send uuid, p_result text, p_provider_id text, p_error text) returns void` (service_role): `p_result` em `sent` | `retry` | `failed`; `retry` incrementa `attempts` e reagenda (`send_at = now() + 5/15/60 min` conforme `attempts` 1/2/3), passando a `failed` na 4ª.
  - `public.record_email_event(p_provider_id text, p_type text, p_at timestamptz) returns void` (service_role): `email.delivered|opened|clicked|bounced|complained`; carimba a coluna correspondente (primeira vez); `bounced`/`complained` → `email_suppressions` (motivo = tipo).
  - `public.read_email_settings_secret(p_org uuid) returns jsonb` (service_role): `{resendKey, fromName, fromEmail, replyTo}` — usado pelo `email-admin`.
  - `public.record_email_domain_status(p_org uuid, p_status text) returns void` (service_role): `p_status` em `verified` | `pending` | `failed` | `not_found`.
  - `public.read_resend_webhook_secrets() returns jsonb` (service_role): lista `[{organizationId, secret}]` (o webhook do Resend é um só por conta; o handler testa cada segredo).
  - `public.unsubscribe_email(p_token text) returns boolean` (anon + authenticated): marca `email_marketing_opt_out_at` (se nulo) e cancela os envios `marketing` agendados do contato com `unsubscribed`; token desconhecido → `false`.
  - `public.email_journey_results(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb` (membro): por passo `{stepId, position, scheduled, sent, delivered, opened, clicked, cancelled: {motivo: n}, recoveredOrders, recoveredTotal}`.
  - `public.dispatch_email_worker()` + `cron.schedule('flowai-email-worker', '* * * * *', 'select public.dispatch_email_worker()')`, no padrão de `dispatch_meta_token_refresh` (URL `/functions/v1/email-worker`).

- [ ] **Step 1: pgTAP que falha** (`062_email_worker.test.sql`): reserva devolve o envio vencido e o passa a `sending`; segunda chamada imediata não devolve o mesmo; `sending` com `claimed_at` de 6 min volta a ser reservado; cancelamentos `step_disabled`, `paid`, `unsubscribed` (marketing) e `suppressed`, cada um com o motivo; sem `email_settings` → `no_settings`; `complete_email_send` `retry` ×3 reagenda 5/15/60 min e a 4ª vira `failed`; `record_email_event` `bounced` → supressão; `unsubscribe_email` token válido → `true` e cancela agendados; token inválido → `false`; `email_journey_results`: pedido pago 3 dias depois do 2º envio conta para o 2º (não para o 1º); pago 8 dias depois não conta; `save_email_settings` não-admin → `42501`; `authenticated` não executa `claim_email_sends`.
- [ ] **Step 2:** FAIL. **Step 3:** Migração. **Step 4:** `npx supabase db reset && npx supabase test db` → PASS; tipos regenerados. **Step 5:** Commit `feat(db): reserva e resultados dos e-mails da loja`.

### Task 6: Edge `email-worker`, `email-admin` e `resend-webhook`

**Files:**
- Create: `supabase/functions/email-worker/{handler,index}.ts`, `supabase/functions/email-admin/{handler,index}.ts`, `supabase/functions/resend-webhook/{handler,index}.ts`, `supabase/functions/_shared/resend.ts`, testes `supabase/functions/tests/{email-worker,email-admin,resend-webhook}.test.ts`
- Modify: `supabase/config.toml` (`resend-webhook` com `verify_jwt = false`)

**Interfaces:**
- Consumes: `renderEmail` (Task 2); RPCs da Task 5; `Authorize` de `_shared/auth.ts` (padrão de `meta-connection`).
- Produces:
  - `_shared/resend.ts`: `sendResendEmail(fetch, key, msg: { from; to; replyTo?; subject; html; text; headers?: Record<string,string> }, idempotencyKey: string): Promise<{ ok: true; id: string } | { ok: false; retry: boolean; code: string }>` — `POST https://api.resend.com/emails`; 429/5xx/rede → `retry: true`; outros 4xx → `retry: false`.
  - `email-worker`: autenticado pelo cabeçalho `X-FlowAI-Worker` (como `meta-token-refresh`); lote de 50; para marketing, `headers: { "List-Unsubscribe": "<{APP_URL}/e/sair/{token}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }` e `unsubscribeUrl` no template; chama `complete_email_send`. `APP_URL` vem do segredo de ambiente `FLOWAI_APP_URL`.
  - `email-admin` (usuário logado, admin): ações `test` (`{organizationId, stepId}` → renderiza o passo com pedido de exemplo e envia ao e-mail do usuário; não grava `email_sends`) e `verify_domain` (`GET https://api.resend.com/domains`, acha o domínio do remetente e grava `domain_status` via `record_email_domain_status`; lê a chave com `read_email_settings_secret`).
  - `resend-webhook`: verifica assinatura Svix (`svix-id`, `svix-timestamp`, `svix-signature`; HMAC-SHA256 de `${id}.${timestamp}.${body}` com o segredo base64 após `whsec_`; tolerância de 5 min) contra cada segredo de `read_resend_webhook_secrets`; chama `record_email_event(data.email_id, type, created_at)`.

- [ ] **Step 1: Testes que falham:** worker — sem segredo interno → 401; envio OK → `complete('sent', id)` e `Idempotency-Key` = `sendId`; 429 → `retry`; 422 → `failed`; marketing leva os dois cabeçalhos `List-Unsubscribe`; nenhuma chamada a `console.*` contém a chave (spy); admin — não-admin → 403; `test` envia para o e-mail do usuário com o assunto do passo; `verify_domain` grava `verified`/`pending`; webhook — assinatura válida → `record_email_event`; inválida → 401; timestamp de 10 min atrás → 401; `email.bounced` repassa o tipo.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `npm run test:edge` → PASS. **Step 5:** Commit `feat(edge): envio pelo Resend e eventos de entrega`.

### Task 7: Painel "E-mails da loja" + descadastro

**Files:**
- Create: `apps/web/src/app/(app)/configuracoes/emails/page.tsx`, `apps/web/src/components/settings/emails/{emails-settings,journey-step-form,email-preview,send-history,journey-results}.tsx`, `apps/web/src/lib/emails/{queries,actions,schemas}.ts` (+ testes `actions.test.ts`, `schemas.test.ts`), `apps/web/src/app/e/sair/[token]/page.tsx`, `apps/web/src/app/e/sair/[token]/actions.ts`
- Modify: `apps/web/src/components/crm/settings-tabs.tsx` (aba "E-mails da loja"), `apps/web/src/lib/supabase/session.ts` (liberar `/e/sair` sem sessão, como `/r`)

**Interfaces:**
- Consumes: RPCs `save_store_connection`, `set_email_journey_enabled`, `save_email_journey_step`, `save_email_settings`, `email_journey_results`, `unsubscribe_email`; Edge `email-admin` (`test`, `verify_domain`); `renderEmail` (prévia no cliente com dados de exemplo).
- Produces: aba em `/configuracoes/emails` com: (1) **Configuração** — remetente, responder-para, chave Resend e segredo do webhook (campos só de escrita; mostra "configurada" quando existir), estado do domínio + botão "Verificar", URL do webhook Yampi e do Resend para copiar, alias da loja e segredo do webhook Yampi; (2) **Carrinho abandonado** — liga/desliga, 3 passos com espera (min/h/dias), liga/desliga, assunto, título, texto, botão, cupom, prévia ao vivo e "Enviar teste para mim"; (3) **Resultados** (últimos 30 dias, via `email_journey_results`); (4) **Histórico** — últimos 100 `email_sends` com estado e motivo em português.
- Rótulos de motivo: `paid` "Pagou antes", `converted` "Comprou", `unsubscribed` "Descadastrado", `suppressed` "Endereço bloqueado", `step_disabled` "Passo desligado", `no_email` "Sem e-mail", `no_recovery_url` "Sem link do carrinho", `no_settings` "Envio não configurado".
- `/e/sair/[token]`: página simples com a marca, botão "Confirmar descadastro" (server action chama `unsubscribe_email`), mensagem final; token inválido mostra "Link inválido" sem dizer se o contato existe. Aceita também `POST` direto (one-click do Gmail) via `route.ts` irmão — se `page.tsx` + `route.ts` não puderem coexistir na mesma rota no Next 16, usar `/e/sair/[token]` (page) e `/e/sair/[token]/one-click` (route) e apontar o `List-Unsubscribe` para o segundo; registrar ruling.

- [ ] **Step 1: Testes que falham** (`schemas.test.ts`, `actions.test.ts` com Supabase simulado como em `apps/web/src/lib/instagram/actions.test.ts`): validação do passo (assunto vazio, corpo > 3000, espera < 1 min ou > 30 dias → mensagens em português); conversão de espera `2h` ↔ `120`; `saveStep` não-admin → erro "Você não tem permissão para esta ação."; `saveSettings` sem chave mantém a atual (não envia `resendKey`); `unsubscribe` token inválido → estado "Link inválido".
- [ ] **Step 2:** FAIL. **Step 3:** Implementar seguindo `configuracoes/canais/page.tsx` (RequireOrg, checagem de papel, Suspense) e os componentes de formulário existentes. **Step 4:** `npx vitest run --root apps/web` e `npx tsc -p apps/web --noEmit` limpos; conferir a tela no navegador local (`npm run dev`) com Supabase local. **Step 5:** Commit `feat(web): tela dos e-mails da loja e descadastro`.

### Task 8: Guia e roteiro do teste real

**Files:** Create `docs/superpowers/emails-setup.md`.

- [ ] **Step 1:** Escrever: (1) Resend — criar conta, adicionar o domínio `useholyspirit.store`, registros DNS (SPF/DKIM/DMARC indicados pelo Resend), ligar rastreio de abertura e clique, criar chave da API (permissão de envio), criar webhook apontando para `https://<ref>.supabase.co/functions/v1/resend-webhook` com os eventos `email.delivered`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`; (2) Yampi — criar webhook para a URL do FlowAI com `cart.reminder`, `order.created`, `order.paid`, `order.status.updated`, copiar o segredo para o FlowAI, **desligar a recuperação de carrinho nativa da Yampi**; (3) Supabase — `FLOWAI_APP_URL` nas Edge Functions; deploy `yampi-webhook`, `email-worker`, `email-admin`, `resend-webhook`, depois `npx supabase db push`; (4) FlowAI — preencher a configuração, verificar domínio, revisar textos, "Enviar teste para mim", ligar a jornada; (5) roteiro: abandonar um carrinho com o próprio e-mail → evento no histórico → 1º e-mail após 60 min → clicar no link e conferir que abre o carrinho (`simulate_url`) → pagar → e-mails seguintes "Pagou antes"; descadastrar por um e-mail e conferir.
- [ ] **Step 2:** Commit `docs: guia dos e-mails da loja`.
