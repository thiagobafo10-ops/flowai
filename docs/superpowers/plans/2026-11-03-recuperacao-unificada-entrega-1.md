# Recuperação unificada — Primeira entrega (Carrinhos + WhatsApp manual) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela **Carrinhos** no FlowAI, alimentada pelo mesmo receptor Yampi dos e-mails, com estado comercial, histórico de e-mails e atendimento **manual** pelo WhatsApp (sem IA, sem disparo automático), registrado com fidelidade e bloqueado por pagamento, pausa, encerramento, bloqueio, falta de autorização, telefone inválido ou link inseguro.

**Architecture:** Amplia o que a etapa 1 dos e-mails criou (`store_carts`, `store_orders`, `contacts`, `email_sends`). Novas colunas no carrinho separam **estado comercial** (derivado de pedidos) de **estágio do atendimento** (manual). Tabelas novas guardam o histórico manual, as autorizações de contato por canal e o modelo da mensagem. Toda regra de elegibilidade vive numa função SQL única, chamada de novo no servidor imediatamente antes de liberar a mensagem e antes de confirmar o envio. A tela usa RPCs autenticadas com RLS; o WhatsApp abre por `https://wa.me/`.

**Tech Stack:** Next 16 (App Router), React 19, Zod 4, Vitest, Playwright; Supabase Postgres (plpgsql, RLS, pgTAP).

**Spec:** `docs/superpowers/specs/2026-11-03-recuperacao-unificada-design.md` (aprovada pelo usuário em 2026-11-03, incluindo a regra de autorização de contato). Este plano cobre as **etapas 1–4** da spec; as etapas 5 (troca do webhook) e 6 (ativação) são operacionais e exigem autorização específica do usuário — não fazem parte deste plano.

## Global Constraints

- Nunca disparar WhatsApp automaticamente; sem IA. Abrir o WhatsApp **não** conta como envio nem entrega.
- Envio registrado só por confirmação explícita (`marked_sent`), com operador e horário; repetir exige `repeat = true`; repetições por falha de rede (mesma `request_key`) não duplicam registros.
- Elegibilidade revalidada no servidor imediatamente antes de liberar mensagem/link (`prepare`) e antes de confirmar (`marked_sent`).
- Ordem dos bloqueios (primeiro que casar vence), com estes textos exatos: `Pagamento confirmado`, `Atendimento encerrado`, `Atendimento pausado`, `Cliente bloqueado para contato`, `WhatsApp bloqueado pelo cliente`, `Sem autorização de contato registrada`, `Telefone ausente ou inválido`, `Link de retomada indisponível`.
- Autorização: só `granted` com `source` (texto, 3–240) e `evidence_at` informados manualmente por um operador; nunca automática; a última por contato/canal vale; `revoked` posterior prevalece e exige novo `granted` para retomar.
- Bloqueio de WhatsApp ≠ descadastro de e-mail; **bloqueio geral** (`contacts.contact_blocked_at`) alcança os dois (o e-mail passa a cancelar com `unsubscribed`).
- Pausa/encerramento do atendimento **não** desliga e-mails; a ação "Interromper também os e-mails" é separada e explícita (cancela envios `scheduled` daquele carrinho com `paused_by_operator`).
- Estado comercial: `abandoned`, `order_created`, `payment_pending`, `paid`, `cancelled`; pedido só se associa ao carrinho por `cart_token` igual ao `token` do carrinho. Pagamento do mesmo contato **sem** associação mostra o aviso `Pagamento não reconciliado` e **não** marca o carrinho como pago nem como recuperado.
- Eventos repetidos ou fora de ordem nunca reabrem carrinho pago nem duplicam contatos.
- Link de retomada: só `https://` cujo host esteja em `store_connections.checkout_hosts` (lista configurada pelo admin; vazia = nenhum link liberado).
- Data original do abandono: `resource.created_at` da Yampi; se faltar, a tela mostra `Data original não informada` (nunca a data de recebimento no lugar).
- Papéis: `owner`/`admin` configuram (modelo, hosts); `agent` e acima atendem (preparar, confirmar, pausar, encerrar, autorizar, bloquear); `viewer` só lê. Escrita sempre checada no servidor (`public.has_role`).
- Sem Redis, Prisma ou worker local; sem importação do banco do Recovery Hub; nenhum envio real em nenhuma tarefa.
- Textos em português. Ramo: `feat/recuperacao-unificada`.

## Review Focus

- `order.paid` chega **antes** do `cart.reminder` do mesmo carrinho → carrinho já nasce `paid`, sem envios e sem atendimento liberado (Task 2, teste "paid before reminder").
- Pagamento acontece entre "Abrir WhatsApp" e "Confirmar envio" → confirmação recusada com `Pagamento confirmado` (Task 3, teste "paid between prepare and confirm").
- Duplo clique / rede caindo no "Confirmar envio" → um único registro (Task 3, teste "same request_key").
- `recovery_url` com host não autorizado ou `javascript:`/`http:` → `Link de retomada indisponível`, link nunca devolvido (Task 3, teste "unsafe link").
- Operador de outra organização com o id do carrinho → `42501`, nada lido nem gravado (Task 3, teste "cross-org").

---

### Task 1: Núcleo puro — telefone, mensagem, link e data do abandono

**Files:**
- Create: `packages/core/src/store/recovery.ts`, `packages/core/src/store/recovery.test.ts`
- Modify: `packages/core/src/store/yampi.ts` (+ teste), `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  function normalizeBrazilMobile(raw: string | null): string | null;      // "+55DD9XXXXXXXX" ou null
  function isAllowedCheckoutUrl(url: string | null, hosts: readonly string[]): boolean;
  function renderWhatsappMessage(template: string, v: { firstName: string | null; link: string; total: number | null; storeName: string; items: { name: string; quantity: number }[] }): string;
  function whatsappUrl(phoneE164: string, text: string): string;           // https://wa.me/55DD9XXXXXXXX?text=<encodeURIComponent>
  export const DEFAULT_WHATSAPP_TEMPLATE: string;
  ```
- Muda: `YampiEvent` de carrinho ganha `cart.abandonedAt: string | null` (ISO 8601 em UTC) e `customer.phone` passa a ser `normalizeBrazilMobile(...)`.

- [ ] **Step 1: Testes que falham:**
  - `normalizeBrazilMobile`: `"(11) 98765-4321"` → `"+5511987654321"`; `"+55 11 98765-4321"` → `"+5511987654321"`; `"5511987654321"` → `"+5511987654321"`; `"1134567890"` (fixo) → `null`; `"98765-4321"` (sem DDD) → `null`; `"(00) 98765-4321"` → `null`; `null` → `null`.
  - `isAllowedCheckoutUrl`: `("https://seguro.useholyspirit.store/cart?x=1", ["seguro.useholyspirit.store"])` → `true`; mesmo host com `http://` → `false`; `"javascript:alert(1)"` → `false`; host `seguro.useholyspirit.store.evil.com` → `false`; lista vazia → `false`; URL inválida → `false`.
  - `renderWhatsappMessage`: template `"Oi, {primeiro_nome}! Seu carrinho na {loja} ({valor}): {link}"` com `firstName "Ana"`, `total 89.9`, `storeName "Holy Spirit"`, `link "https://x"` → `"Oi, Ana! Seu carrinho na Holy Spirit (R$ 89,90): https://x"`; sem nome → `"Oi! Seu carrinho..."` (mesma regra de vírgula órfã de `fillVariables` em `packages/core/src/email/template.ts` — reutilize a função, não duplique); `{itens}` → `"2x Camiseta Maria, 1x Terço"`.
  - `whatsappUrl("+5511987654321", "Oi & tchau")` → `"https://wa.me/5511987654321?text=Oi%20%26%20tchau"`.
  - `DEFAULT_WHATSAPP_TEMPLATE` contém `{primeiro_nome}` e `{link}`.
  - `yampi.test.ts`: fixture de carrinho com `resource.created_at = { date: "2026-11-03 14:05:00.000000", timezone_type: 3, timezone: "America/Sao_Paulo" }` → `abandonedAt === "2026-11-03T17:05:00.000Z"`; sem `created_at` → `null`; telefone da fixture normalizado.
- [ ] **Step 2:** `npx vitest run packages/core` → FAIL. **Step 3:** Implementar (sem dependência nova; fusos via `Intl`/offset: a Yampi manda `timezone` IANA — converter com `Intl.DateTimeFormat` para descobrir o offset daquela data). **Step 4:** `npx vitest run packages/core` e `npx tsc -p packages/core --noEmit` → PASS. **Step 5:** Commit `feat(core): telefone, link e mensagem da recuperação manual`.

### Task 2: Banco — fundação (estados, histórico, autorizações, bloqueios)

**Files:**
- Create: `supabase/migrations/20261105000001_cart_recovery.sql`, `supabase/tests/database/063_cart_recovery_foundation.test.sql`
- Regenerar: `packages/core/src/db/database.types.ts`

**Interfaces:**
- Consumes: `abandonedAt` e telefone normalizado no `p_event` (Task 1); funções vigentes `ingest_yampi_event` (`20261104000001`) e `claim_email_sends` (`20261104000004`).
- Produces:
  - `store_carts` + colunas: `abandoned_at timestamptz`, `order_id uuid` (FK composta para `store_orders`, `on delete set null`), `commercial_status text not null default 'abandoned'` check em (`abandoned`,`order_created`,`payment_pending`,`paid`,`cancelled`), `recovery_stage text not null default 'new'` check em (`new`,`contacted`,`waiting_reply`,`closed`), `paused_at timestamptz`, `pause_reason text`, `closed_at timestamptz`, `last_contact_at timestamptz`.
  - `store_connections.checkout_hosts text[] not null default '{}'`.
  - `contacts.contact_blocked_at timestamptz`, `contacts.contact_blocked_reason text`.
  - `contact_channel_permissions(id, organization_id, contact_id, channel text check = 'whatsapp', status text check in ('granted','revoked'), source text 3..240, evidence_at timestamptz not null, recorded_by uuid not null, created_at)` — só inserção; RLS select membro.
  - `cart_contact_actions(id, organization_id, cart_id, contact_id, actor_id uuid not null, action text check in ('opened_whatsapp','marked_sent','reply_received','paused','resumed','closed','reopened','emails_stopped','note'), note text ≤ 2000, request_key text not null, request_hash text not null, created_at, unique(organization_id, request_key))` — só inserção; RLS select membro.
  - `cart_recovery_settings(organization_id pk, whatsapp_template text 10..2000, updated_by uuid, updated_at)` — RLS select membro.
  - `private.cart_whatsapp_block_reason(p_cart uuid) returns text` — `null` = elegível; textos e ordem exatamente os das Global Constraints. Permissão: última linha de `contact_channel_permissions` do contato (`whatsapp`) — sem linha → `Sem autorização de contato registrada`; última `revoked` → `WhatsApp bloqueado pelo cliente`. Link: `recovery_url` começa com `https://` e o host está em `checkout_hosts` da conexão do carrinho (comparação exata, minúsculas).
  - `private.cart_whatsapp_phone(p_cart uuid) returns text` — telefone do contato se casar `^\+55[1-9][0-9]9[0-9]{8}$`, senão `null`.
  - Redefinição de `ingest_yampi_event` (cópia literal da versão vigente + mudanças): grava `abandoned_at` (só se nulo — nunca sobrescreve); `order` associa por `cart_token` → `store_carts.order_id`; `commercial_status` do carrinho associado: `order.paid` → `paid` (definitivo: eventos posteriores não rebaixam), `statusAlias` `waiting_payment` → `payment_pending`, `cancelled`/`canceled` → `cancelled` (só se não `paid`), demais → `order_created` (só se ainda `abandoned`). Carrinho que chega já com pedido pago associado nasce `paid` e não agenda e-mails.
  - Redefinição de `claim_email_sends` (cópia literal da versão vigente em `20261104000004` + uma mudança): contato com `contact_blocked_at` não nulo cancela com `unsubscribed` em qualquer categoria.

- [ ] **Step 1: pgTAP que falha** (`063_...`, fixtures como `061_store_emails_ingest.test.sql`):
  1. `cart.reminder` com `abandonedAt` grava `abandoned_at`; segundo reminder com outra data não altera.
  2. `order.created` com `cartToken` do carrinho e `statusAlias 'waiting_payment'` → `order_id` preenchido e `payment_pending`.
  3. `order.paid` associado → `paid`; um `order.status.updated` posterior com `cancelled` não rebaixa (continua `paid`).
  4. **paid before reminder**: `order.paid` com `cartToken 'tk9'`, depois `cart.reminder` do carrinho `token 'tk9'` → carrinho `paid`, 0 `email_sends`.
  5. Pedido pago do mesmo contato **sem** `cartToken` → carrinho continua não `paid`.
  6. `cart_whatsapp_block_reason`: cada um dos 8 motivos produzido por um carrinho preparado para ele, e `null` para o carrinho totalmente elegível (telefone `+5511987654321`, `granted`, host autorizado, `abandoned`).
  7. `revoked` depois de `granted` → `WhatsApp bloqueado pelo cliente`; `granted` depois → elegível de novo.
  8. Contato com `contact_blocked_at` → `claim_email_sends` cancela o envio `scheduled` com `unsubscribed`.
  9. RLS: `viewer` da organização lê `cart_contact_actions`; membro de outra organização não lê; `authenticated` não insere direto em nenhuma tabela nova.
- [ ] **Step 2:** `npx supabase test db` → FAIL nos novos. **Step 3:** Migração. **Step 4:** `npx supabase db reset && npx supabase test db` → tudo PASS (inclusive 061 e 062 sem alteração); tipos regenerados; `tsc` de `packages/core` e `apps/web` limpos. **Step 5:** Commit `feat(db): estados do carrinho, histórico manual e autorizações`.

### Task 3: Banco — operações do atendimento

**Files:**
- Create: `supabase/migrations/20261105000002_cart_recovery_rpcs.sql`, `supabase/tests/database/064_cart_recovery_rpcs.test.sql`

**Interfaces:**
- Consumes: tabelas e funções da Task 2.
- Produces (todas `security definer set search_path=''`, `authenticated`; papel checado com `public.has_role`):
  - `list_store_carts(p_org uuid, p_filters jsonb, p_page int, p_page_size int) returns jsonb` (membro) → `{ total, rows: [{ id, customerName, phoneValid, total, itemsCount, abandonedAt, receivedAt, commercialStatus, recoveryStage, paused, unreconciledPayment, blockReason, lastContactAt }] }`. Filtros: `q` (nome/e-mail/telefone, ILIKE), `from`/`to` (sobre `coalesce(abandoned_at, created_at)`), `commercialStatus`, `recoveryStage`, `eligible` (bool). `p_page_size` 1..100; ordenação `coalesce(abandoned_at, created_at) desc`. `unreconciledPayment` = existe `store_orders` pago do mesmo contato com `paid_at >= coalesce(abandoned_at, created_at)` e o carrinho não está `paid`.
  - `get_store_cart(p_org uuid, p_cart uuid) returns jsonb` (membro) → carrinho, itens, `recoveryUrlAllowed` (bool; a URL **não** é devolvida aqui), contato (nome, e-mail, telefone mascarado `+55 11 9****-4321`), permissão vigente (`status`, `source`, `evidenceAt`), bloqueios, `blockReason`, `emails` (`email_sends` do carrinho: passo, estado, motivo, datas) e `actions` (histórico manual com nome do operador).
  - `save_cart_recovery_settings(p_org uuid, p_template text, p_checkout_hosts text[]) returns void` (admin): hosts minúsculos, sem esquema, sem barra, validados `^[a-z0-9.-]+\.[a-z]{2,}$`.
  - `prepare_cart_whatsapp(p_org uuid, p_cart uuid, p_request_key text) returns jsonb` (agent+): revalida `cart_whatsapp_block_reason`; bloqueado → `{ blocked: motivo }` sem telefone, sem link, sem registro; elegível → registra `opened_whatsapp` (idempotente pela `request_key`) e devolve `{ phone, message, actionId }` com a mensagem já renderizada no servidor (modelo de `cart_recovery_settings` ou o padrão da Task 1 copiado na migração; variáveis `{primeiro_nome}`, `{link}`, `{valor}`, `{loja}`, `{itens}`).
  - `record_cart_action(p_org uuid, p_cart uuid, p_action text, p_request_key text, p_note text, p_repeat boolean) returns jsonb` (agent+): ações `marked_sent`, `reply_received`, `paused` (nota obrigatória 3..240), `resumed`, `closed`, `reopened`, `emails_stopped`, `note`. Mesma `request_key` com mesmo conteúdo → devolve o registro existente; com conteúdo diferente → erro `22023` (`idempotency_conflict`). `marked_sent`: revalida o bloqueio (bloqueado → erro `P0001` com o motivo), exige `opened_whatsapp` anterior, e se já houver `marked_sent` no carrinho exige `p_repeat = true` (senão erro `P0001` `repeat_confirmation_required`); grava `recovery_stage = 'waiting_reply'`, `last_contact_at`. `paused`/`resumed`/`closed`/`reopened` mudam `paused_at`/`pause_reason`/`closed_at`/`recovery_stage` (`closed`; `reopened` → `new`). `emails_stopped` cancela `email_sends` `scheduled` do carrinho com `paused_by_operator` (somente esse carrinho). Nota com URL ou `token|secret|password` → `22023`.
  - `record_contact_permission(p_org uuid, p_contact uuid, p_status text, p_source text, p_evidence_at timestamptz) returns uuid` (agent+): `evidence_at` não pode ser futura.
  - `set_contact_blocked(p_org uuid, p_contact uuid, p_blocked boolean, p_reason text) returns void` (agent+): bloquear também cancela `email_sends` `scheduled` do contato com `unsubscribed`.

- [ ] **Step 1: pgTAP que falha** (`064_...`):
  1. **cross-org**: operador da organização B chamando cada RPC com carrinho/contato de A → `42501`, nada gravado.
  2. `viewer` chama `prepare_cart_whatsapp` e `record_cart_action` → `42501`; `agent` consegue; `save_cart_recovery_settings` por `agent` → `42501`.
  3. `prepare` em carrinho elegível → telefone `+5511987654321`, mensagem com o link; um `opened_whatsapp`; repetir com a mesma `request_key` → um só registro.
  4. **unsafe link**: `recovery_url` `http://...`, `javascript:...` e host não listado → `{ blocked: 'Link de retomada indisponível' }`, resposta sem `phone` e sem `message`.
  5. **paid between prepare and confirm**: `prepare` ok → `order.paid` associado via `ingest_yampi_event` → `marked_sent` falha com `Pagamento confirmado`.
  6. **same request_key**: dois `marked_sent` com a mesma chave e conteúdo → um registro; mesma chave com nota diferente → `22023`.
  7. Segundo `marked_sent` com outra chave sem `p_repeat` → `repeat_confirmation_required`; com `p_repeat = true` → grava.
  8. `marked_sent` sem `opened_whatsapp` anterior → erro.
  9. `paused` sem nota → erro; com nota → `Atendimento pausado` no bloqueio; `emails_stopped` cancela só os envios desse carrinho (outro carrinho do mesmo contato continua `scheduled`).
  10. `list_store_carts` com filtros `commercialStatus`, `eligible = true`, `q` por telefone e paginação (`total` correto, `p_page_size` 101 → erro); `unreconciledPayment` verdadeiro no caso do teste 5 da Task 2.
  11. `get_store_cart` não contém a `recovery_url` nem o telefone completo.
  12. `record_contact_permission` com `evidence_at` futura → erro; `set_contact_blocked` cancela `scheduled` do contato.
- [ ] **Step 2:** FAIL. **Step 3:** Migração. **Step 4:** `npx supabase db reset && npx supabase test db` → PASS; tipos regenerados; `tsc` limpo. **Step 5:** Commit `feat(db): operações do atendimento manual de carrinhos`.

### Task 4: Web — lista e detalhe de Carrinhos (leitura)

**Files:**
- Create: `apps/web/src/app/(app)/carrinhos/page.tsx`, `apps/web/src/app/(app)/carrinhos/[id]/page.tsx`, `apps/web/src/components/carts/{cart-filters,cart-table,cart-detail,cart-history}.tsx`, `apps/web/src/lib/carts/{queries,schemas,labels}.ts` (+ `schemas.test.ts`, `labels.test.ts`)
- Modify: `apps/web/src/lib/navigation.ts` (item **Carrinhos**, ícone `ShoppingCart`, descrição "Carrinhos abandonados e atendimento pelo WhatsApp."), `apps/web/vitest.config.ts` se precisar incluir `src/lib/carts`

**Interfaces:**
- Consumes: `list_store_carts`, `get_store_cart` (Task 3).
- Produces: `parseCartFilters(searchParams): CartFilters` (Zod; período `all|today|7d|30d|custom`, fuso `America/Sao_Paulo`, intervalo custom ≤ 366 dias); rótulos `COMMERCIAL_LABELS` (`abandoned` "Abandonado", `order_created` "Pedido criado", `payment_pending` "Aguardando pagamento", `paid` "Pago", `cancelled` "Cancelado"), `STAGE_LABELS` (`new` "Novo", `contacted` "Contato realizado", `waiting_reply` "Aguardando resposta", `closed` "Encerrado"), `ACTION_LABELS` (um por ação da Task 3; `opened_whatsapp` "WhatsApp aberto (não conta como envio)", `marked_sent` "Envio confirmado pelo operador").

- [ ] **Step 1: Testes que falham:** `parseCartFilters` (período custom sem datas → erro "Informe as datas.", intervalo > 366 dias → erro, `page` e `pageSize` limitados a 1..100); rótulos cobrem todos os valores dos checks do banco (teste lista os valores literais).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar seguindo `apps/web/src/app/(app)/contatos` (lista paginada, `RequireOrg`, `Suspense`, estados vazio/erro/carregando). A tabela mostra cliente, valor, itens, data do abandono (ou "Data original não informada"), estado comercial, estágio, selo "Pagamento não reconciliado" quando houver e o motivo de bloqueio. O detalhe mostra itens, estado, permissão vigente, bloqueios, histórico de e-mails e histórico manual — **sem** botões de ação nesta tarefa. **Step 4:** `npx vitest run --root apps/web` e `npx tsc -p apps/web --noEmit` limpos; abrir `/carrinhos` no `npm run dev` com dados sintéticos e conferir lista, filtro, vazio e detalhe. **Step 5:** Commit `feat(web): lista e detalhe de carrinhos`.

### Task 5: Web — atendimento manual

**Files:**
- Create: `apps/web/src/lib/carts/actions.ts` (+ `actions.test.ts`), `apps/web/src/components/carts/{whatsapp-panel,cart-actions,permission-dialog,recovery-settings}.tsx`, `apps/web/src/app/(app)/configuracoes/carrinhos/page.tsx`
- Modify: `apps/web/src/components/carts/cart-detail.tsx`, `apps/web/src/components/crm/settings-tabs.tsx` (aba "Carrinhos", admin/owner)

**Interfaces:**
- Consumes: `prepare_cart_whatsapp`, `record_cart_action`, `record_contact_permission`, `set_contact_blocked`, `save_cart_recovery_settings` (Task 3); `whatsappUrl`, `renderWhatsappMessage`, `DEFAULT_WHATSAPP_TEMPLATE` (Task 1, só para a prévia do modelo).
- Produces: server actions `prepareWhatsapp(cartId)`, `confirmSent(cartId, actionKey, repeat)`, `recordAction(cartId, action, note?)`, `savePermission(contactId, status, source, evidenceAt)`, `setBlocked(contactId, blocked, reason)`, `saveRecoverySettings(template, hosts)`. Cada ação gera a `request_key` (`crypto.randomUUID()`) **no cliente, uma por intenção**, e reaproveita a mesma chave ao repetir após erro de rede.

Comportamento da tela (detalhe do carrinho):
- Bloqueado → mostra só o motivo; botões de contato desabilitados.
- **Preparar mensagem** → chama `prepareWhatsapp`; mostra a mensagem num campo **editável** e o botão **Abrir WhatsApp** (link `whatsappUrl(phone, textoEditado)`, `target="_blank"`, `rel="noopener noreferrer"`). Texto de apoio: "Abrir o WhatsApp não registra envio. Depois de enviar, confirme abaixo."
- **Confirmar que enviei** → `confirmSent`; se o servidor responder `repeat_confirmation_required`, pede confirmação "Já houve envio para este carrinho. Registrar outro envio?" e reenvia com `repeat = true`.
- **Pausar** (motivo obrigatório), **Retomar**, **Encerrar**, **Reabrir**, **Registrar resposta**, **Interromper também os e-mails** (diálogo explica que o atendimento e os e-mails são separados).
- **Autorização de contato**: diálogo com status (`Autorizado`/`Revogado`), origem (texto) e data da evidência; nunca pré-preenchido.
- **Bloquear cliente** (motivo) e desbloquear.
- `viewer` vê o detalhe sem nenhum botão de ação.
- Configurações → Carrinhos (admin/owner): modelo da mensagem com prévia (`renderWhatsappMessage` com dados de exemplo) e lista de hosts de checkout autorizados (um por linha).

- [ ] **Step 1: Testes que falham** (`actions.test.ts`, Supabase simulado como em `apps/web/src/lib/emails/actions.test.ts`): `prepareWhatsapp` bloqueado → retorna o motivo e nenhum `url`; elegível → `url` começa com `https://wa.me/5511987654321?text=`; `confirmSent` repassa `p_repeat` e traduz `repeat_confirmation_required`; `recordAction("paused")` sem nota → erro "Informe o motivo da pausa." sem chamar o banco; `savePermission` com data futura → erro sem chamar o banco; `saveRecoverySettings` normaliza hosts (`"HTTPS://Seguro.Loja.com/"` → `"seguro.loja.com"`) e rejeita host inválido; `viewer` (papel lido da organização ativa) → "Você não tem permissão para esta ação." sem chamar o banco.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** `npx vitest run --root apps/web`, `npx tsc -p apps/web --noEmit` limpos. **Step 5:** Commit `feat(web): atendimento manual de carrinhos pelo WhatsApp`.

### Task 6: Homologação isolada + roteiro de troca e retorno

**Files:**
- Create: `apps/web/e2e/carts.spec.ts`, `docs/superpowers/recuperacao-troca.md`

- [ ] **Step 1: E2E (Playwright, Supabase local, dados sintéticos inseridos por `ingest_yampi_event` com a chave de serviço local só no setup do teste)** seguindo `apps/web/e2e/automation.spec.ts` e o fixture `signUpWithOrg`: (a) carrinho elegível — preparar, editar a mensagem, o link do botão aponta para `https://wa.me/...` (não abrir), confirmar envio, histórico mostra "WhatsApp aberto (não conta como envio)" e "Envio confirmado pelo operador"; (b) segundo envio pede confirmação de repetição; (c) carrinho sem autorização mostra "Sem autorização de contato registrada" e registrar autorização libera; (d) carrinho pago mostra "Pagamento confirmado" sem botões; (e) a jornada de e-mail existente continua passando (`apps/web/e2e/*` atuais verdes) e as suítes `npm test`, `npm run test:edge`, `npx supabase test db` verdes. Nenhuma chamada externa.
- [ ] **Step 2: `docs/superpowers/recuperacao-troca.md`** (português, passos numerados, sem segredos): (1) antes da troca — fazer backup restaurável do banco do Recovery Hub; anotar só contagens (carrinhos abertos, atendimentos pendentes, bloqueios); exportar e registrar no FlowAI os bloqueios e autorizações conhecidos (com origem e data reais), um a um; definir a **data de corte**; (2) configurar no FlowAI os hosts de checkout e o modelo; (3) troca — conferir no painel da Yampi como editar URL e segredo do webhook existente; anotar a configuração anterior em local seguro; apontar para a URL do `yampi-webhook` do FlowAI sem excluir o webhook antigo antes de confirmar; (4) validação com abandono real e pagamento controlado da conta do proprietário — só com autorização específica; (5) retorno — reapontar para o Recovery Hub com a configuração anotada; (6) pendências antigas seguem no Recovery Hub até serem encerradas; (7) ativação dos e-mails e do cron é etapa separada (ver `docs/superpowers/emails-setup.md`), com coordenação da recuperação nativa da Yampi.
- [ ] **Step 3:** Rodar tudo e anexar a saída no relatório. **Step 4:** Commit `test(e2e): homologação dos carrinhos` e `docs: roteiro de troca e retorno da recuperação`.
