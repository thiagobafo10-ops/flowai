# FlowAI — Fase 2: Layout + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App shell com os 9 módulos (tema claro/escuro, responsivo), eventos de domínio gravados pelo banco e Dashboard com 9 indicadores, seletor de período e 3 gráficos.

**Architecture:** Gatilhos `SECURITY DEFINER` gravam `events`; a função `dashboard_metrics` (`SECURITY INVOKER`, RLS) calcula KPIs/séries/funil em um JSON validado por Zod em `@flowai/core`. O app renderiza o dashboard no servidor e troca de período no cliente via React Query + Route Handler `GET /api/dashboard`. O shell lê uma lista central de navegação.

**Tech Stack:** Next.js 16.4 (App Router, `cacheComponents`), React 19, Tailwind 4, shadcn/ui (registry base-nova / `@base-ui/react`), `next-themes`, `lucide-react`, `@tanstack/react-query`, `recharts@^3`, Supabase local (Postgres 17), pgTAP, Vitest (em `packages/core`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-09-fase-2-layout-dashboard-design.md` (e, como base, `docs/superpowers/specs/2026-10-07-flowai-mvp-design.md`)

## Global Constraints

- Branch `feat/fase-2-layout-dashboard`. Nunca editar migrations existentes (`20261007000001..09`); criar novas com prefixo `20261009`.
- Textos de UI e mensagens em pt-BR, exatamente como na spec. Nenhum dado fictício na UI; estados vazios explícitos.
- Toda página e Server Action/Route Handler de `(app)` chama `getActiveOrg()` por conta própria; o layout não é barreira de segurança.
- Service role nunca em `apps/web`. Nunca `select *` em `channels`.
- Leituras dinâmicas (cookies, headers, `getActiveOrg`, RPC) dentro de `<Suspense>` (Next 16 `cacheComponents`).
- Funções `SECURITY DEFINER`: `set search_path = ''`, nomes qualificados, `revoke ... from public, anon`, grants mínimos. RLS em toda tabela; nenhuma policy para `anon`.
- Docker: em todo comando que usa `docker`/`supabase`, prefixar `export PATH="/c/Users/thiag/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"`.
- Verificação de banco: `npm run db:reset; npm run db:test` (todos os arquivos). Após mudar o schema: `npm run db:types`.
- Lógica pura (formatação, período, transformação de dados) vive em `packages/core` com testes Vitest; `apps/web` não tem Vitest.
- Commits terminam com a linha `Co-Authored-By` da atribuição da própria sessão.

## Review Focus

1. **Organização com fuso diferente de São Paulo** (ex.: `America/Manaus`) → "hoje" e os dias das séries seguem o fuso da organização, não o do servidor. Teste na Task 2.
2. **Usuário com papel Visualizador** → vê o dashboard normalmente (função funciona para qualquer membro). Teste na Task 2.
3. **Deal ganho movido de volta para uma etapa aberta enquanto o contato já tem outro deal aberto** → erro de unicidade (23505) em vez de dois deals abertos silenciosos. Teste na Task 1.
4. **Organização sem pipeline padrão ou com deals em outro pipeline** → funil = `[]` quando não há pipeline padrão; oportunidades/funil consideram só o pipeline padrão; valor potencial considera todos os deals abertos. Teste na Task 2.
5. **Gaveta da sidebar no celular** → fecha ao navegar para outro módulo. Teste na Task 6.

---

## Estrutura de arquivos

```
supabase/migrations/
  20261009000001_domain_events.sql        emit_event, gatilhos, status do deal segue etapa
  20261009000002_dashboard_metrics.sql    dashboard_metrics
  20261009000003_auth_event_rate_limit.sql log_auth_event com rate limit
supabase/tests/database/
  011_domain_events.test.sql  012_dashboard_metrics.test.sql  013_auth_event_rate_limit.test.sql
packages/core/src/
  tenancy/resolve-active-org.ts (+ test)          desempate
  dashboard/period.ts (+ test)                    DashboardPeriod, parsePeriod, periodToDays, periodLabel
  dashboard/format.ts (+ test)                    formatInteger, formatBRL, formatPercent
  dashboard/metrics.ts (+ test)                   dashboardMetricsSchema, type DashboardMetrics, toChartData
apps/web/src/
  app/globals.css                                 tokens (índigo, charts, dark)
  app/layout.tsx                                  ThemeProvider + QueryProvider
  components/providers/{theme-provider,query-provider}.tsx
  lib/navigation.ts                               NAV_ITEMS, roleLabel
  components/shell/{app-sidebar,app-header,mobile-nav,theme-toggle,user-menu,nav-links}.tsx
  components/module-placeholder.tsx
  app/(app)/layout.tsx                            shell
  app/(app)/{inbox,contatos,pipeline,automacoes,ia,conhecimento,analytics,configuracoes}/page.tsx
  lib/dashboard/get-dashboard-metrics.ts          server: RPC + parse
  app/api/dashboard/route.ts                      GET ?periodo=
  app/(app)/dashboard/page.tsx
  components/dashboard/{dashboard-view,period-selector,kpi-grid,kpi-card,charts,getting-started-banner,dashboard-skeleton}.tsx
  components/auth/*, components/onboarding/*     a11y
apps/web/e2e/
  shell.spec.ts  dashboard.spec.ts  support/local-db.ts (+ helpers)
```

---

### Task 1: Eventos de domínio pelo banco

**Files:**
- Create: `supabase/migrations/20261009000001_domain_events.sql`
- Test: `supabase/tests/database/011_domain_events.test.sql`

**Interfaces:**
- Consumes: tabelas `events`, `contacts`, `conversations`, `messages`, `deals`, `pipeline_stages`; helpers `tests.*` (`create_user`, `create_org`, `add_member`, `authenticate_as`, `clear_authentication`); `\gset` funciona.
- Produces:
  - `public.emit_event(p_org uuid, p_type text, p_conversation_id uuid, p_contact_id uuid, p_deal_id uuid, p_payload jsonb default '{}') returns void` — SECURITY DEFINER; `actor_type='user', actor_id=auth.uid()` se autenticado, senão `actor_type='system', actor_id=null`; sem execute para `public/anon/authenticated`.
  - Gatilhos AFTER (FOR EACH ROW), com os tipos e payloads exatos da spec §3.2: `contact_created {source}`, `conversation_created {channel_id}`, `handoff {from_status}` (status passa a `pending_human`), `conversation_closed {from_status}` (status passa a `closed`), `message_received {message_id}` (inbound e não nota interna), `ai_replied {message_id}` (`sender_type='ai'`), `deal_created {stage_id, value}`, `deal_stage_changed {from_stage_id, to_stage_id}`, `deal_won {value}` / `deal_lost {value}` (status passa a won/lost no UPDATE **ou** INSERT já em won/lost). Colunas `conversation_id/contact_id/deal_id` preenchidas quando conhecidas.
  - Gatilho BEFORE `INSERT OR UPDATE OF stage_id` em `deals`: etapa `is_won` → `status='won'`, `is_lost` → `'lost'`, senão `'open'`.
  - Eventos só disparam quando o valor realmente muda (`old.x is distinct from new.x`).

- [ ] **Step 1: Escrever o teste que falha** — casos (ajuste `plan(N)`):

```sql
-- setup como postgres: org A (owner ua, agent uagent), pipeline padrão com etapas
--   Novo(0) Interessado(1) Ganho(is_won) Perdido(is_lost); canal ch; contato c1
-- 1. insert contacts → exatamente 1 evento contact_created com contact_id e payload->>'source'
-- 2. como uagent (authenticate_as): insert conversation → evento conversation_created
--    com actor_type='user' e actor_id=uagent
-- 3. como postgres: o mesmo insert → actor_type='system' e actor_id null
-- 4. mensagem inbound → message_received; nota interna outbound (is_internal_note) → nenhum evento
-- 5. mensagem sender_type='ai' → ai_replied
-- 6. update conversations status open→pending_human → 1 handoff {from_status:'open'};
--    update repetido para o mesmo status → nenhum evento novo
-- 7. status → closed → conversation_closed
-- 8. insert deal em Novo → deal_created {stage_id, value}; status = 'open'
-- 9. update stage_id → Interessado → deal_stage_changed {from_stage_id,to_stage_id}; status 'open'
-- 10. stage_id → Ganho → status 'won' e evento deal_won {value}
-- 11. insert deal direto em Perdido → status 'lost', eventos deal_created e deal_lost
-- 12. Review Focus #3: contato com deal ganho D1 e outro deal aberto D2 no mesmo pipeline;
--     mover D1 para Novo → throws_ok '23505'
-- 13. agent: select public.emit_event(...) → throws_ok '42501'
-- 14. eventos de A não visíveis para usuário de outra org (count = 0)
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run db:reset; npm run db:test` → FAIL em 011.
- [ ] **Step 3: Implementar a migration.**
- [ ] **Step 4: Rodar e ver passar** — todos os arquivos pgTAP ok (incluindo 001–010).
- [ ] **Step 5: Commit** — `feat(db): domain events emitted by triggers; deal status follows stage`

---

### Task 2: Função `dashboard_metrics`

**Files:**
- Create: `supabase/migrations/20261009000002_dashboard_metrics.sql`
- Test: `supabase/tests/database/012_dashboard_metrics.test.sql`
- Modify (gerado): `packages/core/src/db/database.types.ts` (`npm run db:types`)

**Interfaces:**
- Consumes: eventos da Task 1; `public.is_member`; `organizations.timezone`; `pipelines.is_default`; `channels.status`.
- Produces: `public.dashboard_metrics(p_org uuid, p_days int) returns jsonb` — `SECURITY INVOKER`, `stable`, `search_path=''`, execute só para `authenticated`. JSON exatamente no formato da spec §4.2, definições da spec §4.3:
  - `p_days not in (1,7,30)` → `raise ... errcode '22023'`; `not public.is_member(p_org)` → `errcode '42501'`.
  - Janela: `start = (date_trunc('day', now() at time zone tz) - (p_days-1) * interval '1 day') at time zone tz`; `end = now()`. "Hoje" = `date_trunc('day', now() at time zone tz) at time zone tz`.
  - `day` nas séries = data local (`YYYY-MM-DD`) na tz da org; um ponto por dia da janela (gerar com `generate_series`), dias vazios = 0, ordem crescente.
  - `funnel`: etapas do pipeline padrão por `position`, `count` e `value` (numeric → number) dos deals daquela etapa; `[]` se não houver pipeline padrão.
  - `resolution_rate`/`conversion_rate`: número entre 0 e 1 (ex.: `0.5`) ou `null`.
  - `has_activity`: existe qualquer evento da org **ou** canal com `status='active'`.

- [ ] **Step 1: Escrever o teste que falha** — dados conhecidos (inseridos como postgres; eventos gerados pelos gatilhos; backdating via `update public.events set created_at = …` como postgres):

```sql
-- Orgs criadas com public.create_organization_with_owner (autenticado como o owner) para ter o
-- pipeline padrão de 7 etapas (Novo, Interessado, Qualificado, Orçamento, Negociação, Ganho, Perdido).
-- Org A (tz 'America/Sao_Paulo'): 3 contatos lead (c1,c2,c3), c3 com contact_created recuado 10 dias;
-- conv1 (c1): 2 inbound + 1 ai; conv2 (c2): 1 inbound; conv2 → pending_human; conv1 → closed;
-- deal A (c1) em Interessado valor 1000; deal B (c2) em Novo valor 500 → movido para Ganho.
-- Esperado p_days=7:
--   conversations_today 2, new_contacts 2, leads 3, opportunities 1, potential_value 1000,
--   ai_handled_conversations 1, handoffs 1, resolution_rate 0.5, conversion_rate 0.5,
--   has_activity true, jsonb_array_length(conversations_per_day) = 7, último ponto count 2,
--   funnel: 7 etapas em ordem; Interessado count 1 value 1000; Ganho count 1 value 500; demais 0
-- p_days=30: new_contacts 3; jsonb_array_length(series) = 30
-- p_days=1: new_contacts 2; series length 1
-- Fuso: evento message_received com created_at = meia-noite local de hoje - 1 minuto
--   NÃO conta em conversations_today
-- Review Focus #1: org B com timezone 'America/Manaus' e evento às 00:30 locais de hoje
--   (= 04:30 UTC) conta em conversations_today de B
-- Org vazia: has_activity false, rates null, todas as contagens 0, funnel com 7 etapas zeradas
-- Review Focus #4: org criada com tests.create_org (sem pipeline) → funnel = '[]'; deal aberto em pipeline não padrão
--   conta em potential_value mas não em opportunities
-- Review Focus #2: viewer de A chama a função → lives_ok e mesmos números
-- Usuário de B chamando com p_org = A → throws_ok '42501'
-- p_days = 3 → throws_ok '22023'
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar a migration.**
- [ ] **Step 4: Rodar e ver passar** (todos os arquivos); depois `npm run db:types` e `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(db): dashboard_metrics with KPIs, daily series and pipeline funnel`

---

### Task 3: Pendências da Fase 1 — desempate da org ativa e rate limit do `log_auth_event`

**Files:**
- Modify: `packages/core/src/tenancy/resolve-active-org.ts`, `packages/core/src/tenancy/resolve-active-org.test.ts`
- Create: `supabase/migrations/20261009000003_auth_event_rate_limit.sql`
- Test: `supabase/tests/database/013_auth_event_rate_limit.test.sql`

**Interfaces:**
- Produces:
  - `resolveActiveOrg` (mesma assinatura): ordena por `createdAt` e, em empate, por `organizationId` crescente.
  - `public.log_auth_event(p_action text, p_ip inet default null)` substituída (`create or replace`, mesma assinatura e grants): após validar, se `public.check_rate_limit('auth_event:' || uid::text, 30, 3600)` for falso → retorna sem gravar (sem erro).

- [ ] **Step 1: Testes que falham**

```ts
it("em empate de createdAt escolhe o menor organizationId", () => {
  expect(resolveActiveOrg(null, [m("b", "2026-01-01"), m("a", "2026-01-01")])).toBe("a");
  expect(resolveActiveOrg(null, [m("a", "2026-01-01"), m("b", "2026-01-01")])).toBe("a");
});
```

```sql
-- 013: usuário autenticado chama log_auth_event('auth.login') 31 vezes →
--   lives_ok em todas; count de audit_logs auth.login do usuário = 30
-- outro usuário ainda grava (chave por usuário) → count 1
```

- [ ] **Step 2: Rodar e ver falhar** — `npm test` e `npm run db:reset; npm run db:test`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `fix: deterministic active-org tiebreak; rate-limit auth audit events`

---

### Task 4: Lógica pura do dashboard em `@flowai/core`

**Files:**
- Create: `packages/core/src/dashboard/period.ts`, `format.ts`, `metrics.ts` e os três `*.test.ts`
- Modify: `packages/core/src/index.ts` (re-exportar)

**Interfaces:**
- Consumes: formato JSON da Task 2.
- Produces:
  - `type DashboardPeriod = "hoje" | "7d" | "30d"`; `parsePeriod(value: string | string[] | undefined | null): DashboardPeriod` (inválido/ausente → `"7d"`); `periodToDays(p): 1 | 7 | 30`; `periodLabel(p): string` → `"hoje" | "últimos 7 dias" | "últimos 30 dias"`; `PERIOD_OPTIONS: { value: DashboardPeriod; label: "Hoje" | "7 dias" | "30 dias" }[]`.
  - `formatInteger(n: number): string` (pt-BR, ex.: `1.234`); `formatBRL(n: number): string` (`R$ 1.000,00`); `formatPercent(rate: number | null): string` (1 casa: `0.375` → `37,5%`; `null` → `"—"`).
  - `dashboardMetricsSchema` (Zod, espelha spec §4.2; números via `z.coerce.number()` onde o Postgres pode devolver string) e `type DashboardMetrics = z.infer<typeof dashboardMetricsSchema>`.
  - `toChartData(m: DashboardMetrics): { conversations: { label: string; count: number }[]; aiVsHandoff: { label: string; ai: number; handoff: number }[]; funnel: { name: string; count: number; value: number }[] }` — `label` = `dd/MM` a partir de `day` (`"2026-10-03"` → `"03/10"`, sem conversão de fuso).

> Nota: `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })` usa espaço não separável (` `) após `R$`; os testes comparam com `"R$ 1.000,00"`.

- [ ] **Step 1: Testes que falham**

```ts
expect(parsePeriod("30d")).toBe("30d"); expect(parsePeriod("xx")).toBe("7d");
expect(parsePeriod(undefined)).toBe("7d"); expect(parsePeriod(["hoje"])).toBe("hoje");
expect(periodToDays("hoje")).toBe(1); expect(periodLabel("7d")).toBe("últimos 7 dias");
expect(formatInteger(1234)).toBe("1.234");
expect(formatBRL(1000)).toBe("R$ 1.000,00");
expect(formatPercent(0.375)).toBe("37,5%"); expect(formatPercent(0)).toBe("0,0%");
expect(formatPercent(null)).toBe("—");
// schema: aceita o JSON de exemplo da spec §4.2 (com funnel de 1 etapa); rejeita kpis ausente
// schema: "potential_value": "1000.00" (string) → 1000
// toChartData: day "2026-10-03" → label "03/10"; funnel preserva ordem e nomes
```

- [ ] **Step 2: Rodar e ver falhar** — `npm test`.
- [ ] **Step 3: Implementar e re-exportar.**
- [ ] **Step 4: Rodar e ver passar** — `npm test`, `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(core): dashboard period, formatters, metrics schema and chart mapping`

---

### Task 5: Tema (tokens índigo, modo escuro) e providers

**Files:**
- Modify: `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/components/providers/theme-provider.tsx`, `apps/web/src/components/providers/query-provider.tsx`, `apps/web/src/components/shell/theme-toggle.tsx`

**Interfaces:**
- Produces:
  - `<ThemeProvider>` (`next-themes`: `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`); `<html suppressHydrationWarning>`.
  - `<QueryProvider>` (um `QueryClient` por montagem via `useState`; `staleTime: 30_000`, `retry: 1`).
  - `<ThemeToggle />` — botão com `aria-label="Alterar tema"` que abre menu com as opções exatas "Claro", "Escuro", "Sistema".
  - Tokens: `--primary` índigo (claro: índigo-600; escuro: índigo-400/500) e `--chart-1..5` em `:root` e `.dark`, paleta neutra zinc.

- [ ] **Step 1: Implementar** (sem teste unitário; coberto pelo e2e da Task 6). Adicionar componentes shadcn necessários (`npx shadcn@latest add dropdown-menu`); se o registry não tiver, implementar o menu com `@base-ui/react/menu`.
- [ ] **Step 2: Verificar** — `npm run typecheck`, `npm run lint -w apps/web`, `npm run build -w apps/web`; `npm run e2e -w apps/web` continua verde (10 testes da Fase 1).
- [ ] **Step 3: Commit** — `feat(web): indigo theme tokens, dark mode and app providers`

---

### Task 6: App shell — navegação, sidebar, cabeçalho, gaveta móvel

**Files:**
- Create: `apps/web/src/lib/navigation.ts`, `apps/web/src/components/shell/{app-sidebar,app-header,mobile-nav,nav-links,user-menu}.tsx`
- Modify: `apps/web/src/app/(app)/layout.tsx`, `README.md` (seção "Convenções do app": getActiveOrg por página/ação)
- Test: `apps/web/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `getActiveOrg()`, `signOut`, `<ThemeToggle />` (Task 5).
- Produces:
  - `type NavItem = { href: string; label: string; icon: LucideIcon; description: string }`; `NAV_ITEMS: readonly NavItem[]` — ordem, rotas, ícones e descrições exatamente da spec §2.1/§2.2 (Dashboard sem descrição de placeholder: `description: ""`).
  - `roleLabel(role: OrgRole): "Proprietário" | "Administrador" | "Agente" | "Visualizador"`.
  - `findNavItem(pathname: string): NavItem | undefined` (casa rota exata ou sub-rota).
  - Cookie `flowai_sidebar` = `expanded | collapsed` (lido no servidor no layout; escrito no cliente ao recolher; `path=/`, `max-age` 1 ano, `sameSite=lax`).
  - Layout: `<aside aria-label="Navegação principal">` visível ≥1024px; `<header>` com título da página (`findNavItem`), botão "Abrir menu" (<1024px), `<ThemeToggle />`, `<UserMenu />` (nome, e-mail, "Sair"). Rodapé da sidebar: nome da org + `roleLabel`. Item ativo com `aria-current="page"`. Botão "Recolher menu"/"Expandir menu".
  - O layout busca o usuário (nome de `profiles.full_name`, e-mail de `auth.getUser()`) e passa ao cliente só `{ orgName, role, userName, userEmail, sidebar }`.

- [ ] **Step 1: e2e que falha** — `apps/web/e2e/shell.spec.ts` (usa signup + onboarding como em `onboarding.spec.ts`; `clearRateLimits()` em `beforeEach`):

```ts
test("sidebar mostra os 9 módulos na ordem e marca o ativo", async ({ page }) => {
  // após onboarding, em /dashboard (viewport 1280x800)
  const nav = page.getByRole("complementary", { name: "Navegação principal" });
  await expect(nav.getByRole("link")).toHaveText([
    "Dashboard","Inbox","Contatos","Pipeline","Automações","IA","Conhecimento","Analytics","Configurações",
  ]);
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByText("Proprietário")).toBeVisible();
});
test("tema escuro persiste após recarregar", async ({ page }) => {
  await page.getByRole("button", { name: "Alterar tema" }).click();
  await page.getByRole("menuitem", { name: "Escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
test("recolher a sidebar persiste após recarregar", async ({ page }) => {
  await page.getByRole("button", { name: "Recolher menu" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expandir menu" })).toBeVisible();
});
test("no celular a gaveta abre e fecha ao navegar", async ({ page }) => { // Review Focus #5
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("complementary", { name: "Navegação principal" })).toBeHidden();
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Contatos" }).click();
  await expect(page).toHaveURL(/\/contatos$/);
  await expect(page.getByRole("dialog")).toBeHidden();
});
test("menu do usuário mostra e-mail e sai", async ({ page }) => {
  await page.getByRole("button", { name: "Menu do usuário" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
```

(O teste da gaveta navega para `/contatos`, que só existe após a Task 7 — até lá aceitar 404 na página mas exigir a URL e a gaveta fechada.)

- [ ] **Step 2: Rodar e ver falhar** — `npm run e2e -w apps/web -- shell.spec.ts`.
- [ ] **Step 3: Implementar** (shadcn `sheet`/`dropdown-menu`/`tooltip` se disponíveis no registry; senão primitives de `@base-ui/react`). Ajustar `onboarding.spec.ts`/`hardening.spec.ts` se dependerem do header antigo (o botão "Sair" passa a ficar no menu do usuário).
- [ ] **Step 4: Rodar e ver passar** — e2e completo, typecheck, lint, build.
- [ ] **Step 5: Commit** — `feat(web): app shell with sidebar, header, theme toggle and mobile drawer`

---

### Task 7: Páginas "Em construção"

**Files:**
- Create: `apps/web/src/components/module-placeholder.tsx`; `apps/web/src/app/(app)/{inbox,contatos,pipeline,automacoes,ia,conhecimento,analytics,configuracoes}/page.tsx`
- Modify: `apps/web/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `NAV_ITEMS`, `getActiveOrg()`.
- Produces: `<ModulePlaceholder href="/inbox" />` — busca o item em `NAV_ITEMS`, renderiza ícone, `<h1>` com o label, a `description` e o selo "Em construção". Cada página: `getActiveOrg()` dentro de `<Suspense>` (redireciona a `/onboarding` se `null`) + `<ModulePlaceholder>`.

- [ ] **Step 1: e2e que falha** — em `shell.spec.ts`:

```ts
test("módulos não construídos mostram Em construção", async ({ page }) => {
  for (const [href, title, text] of [
    ["/inbox", "Inbox", "Todas as conversas de WhatsApp e Instagram em um só lugar."],
    ["/configuracoes", "Configurações", "Organização, equipe e integrações."],
  ]) {
    await page.goto(href);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(text)).toBeVisible();
    await expect(page.getByText("Em construção")).toBeVisible();
  }
});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar** — e2e completo, typecheck, lint, build.
- [ ] **Step 5: Commit** — `feat(web): under-construction pages for upcoming modules`

---

### Task 8: Dashboard — dados (servidor + Route Handler)

**Files:**
- Create: `apps/web/src/lib/dashboard/get-dashboard-metrics.ts`, `apps/web/src/app/api/dashboard/route.ts`
- Modify: `apps/web/e2e/support/local-db.ts` (helpers abaixo)

**Interfaces:**
- Consumes: `getActiveOrg()`, `createServerClient()`, RPC `dashboard_metrics`, `dashboardMetricsSchema`, `parsePeriod`, `periodToDays`.
- Produces:
  - `getDashboardMetrics(orgId: string, period: DashboardPeriod): Promise<DashboardMetrics>` — chama a RPC e valida com o schema; erro do Supabase ou de parse → `throw`.
  - `GET /api/dashboard?periodo=…` → `200` com `DashboardMetrics`; sem sessão ou sem org → `401 { error: "unauthorized" }`; falha → `500 { error: "Não foi possível carregar o dashboard." }`; `Cache-Control: no-store`.
  - Helpers e2e: `seedDashboardData(email: string): void` (cria no org do usuário, como postgres, exatamente o cenário da Task 2 para org A, incluindo c3 recuado 10 dias); `breakDashboardRpc()` / `restoreDashboardRpc()` (revoke/grant execute de `dashboard_metrics` para `authenticated`).
  - Proxy: requisições a `/api/*` sem sessão devem receber `401` JSON em vez de redirect — ajustar `updateSession` para não redirecionar caminhos `/api/` (cada Route Handler valida a sessão).

- [ ] **Step 1: e2e que falha** — `apps/web/e2e/dashboard.spec.ts` (primeiros casos):

```ts
test("API do dashboard exige sessão", async ({ request }) => {
  const res = await request.get("/api/dashboard?periodo=7d", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});
test("API devolve métricas do período", async ({ page }) => {
  // signup + onboarding; seedDashboardData(email)
  const res = await page.request.get("/api/dashboard?periodo=30d");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.kpis.new_contacts).toBe(3);
  expect(body.series.conversations_per_day).toHaveLength(30);
});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar** — e2e completo, typecheck, lint, build.
- [ ] **Step 5: Commit** — `feat(web): dashboard data loader and /api/dashboard route`

---

### Task 9: Dashboard — UI (cards, gráficos, banner, período, estados)

**Files:**
- Modify: `apps/web/src/app/(app)/dashboard/page.tsx`
- Create: `apps/web/src/components/dashboard/{dashboard-view,period-selector,kpi-grid,kpi-card,charts,getting-started-banner,dashboard-skeleton}.tsx`
- Modify: `apps/web/package.json` (`recharts@^3`), `apps/web/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: Tasks 4 e 8.
- Produces:
  - Página: lê `searchParams.periodo` → `parsePeriod`; dentro de `<Suspense fallback={<DashboardSkeleton />}>` chama `getActiveOrg()` e `getDashboardMetrics` e passa `initialData` + `period` a `<DashboardView>` (client).
  - `<DashboardView>`: React Query `queryKey: ["dashboard", orgId, period]`, `queryFn` = `fetch('/api/dashboard?periodo=…')`, `initialData` só para o período inicial; troca de período atualiza a URL com `router.replace('?periodo=…', { scroll: false })`; erro → texto "Não foi possível carregar o dashboard." + botão "Tentar novamente" (`refetch`); carregando → `<DashboardSkeleton />`.
  - `<PeriodSelector>`: grupo de botões com `role="radiogroup"` e opções "Hoje", "7 dias", "30 dias" (`role="radio"`, `aria-checked`).
  - Cards: títulos, formatos e legendas exatamente da spec §5 (legenda de período via `periodLabel`); cada card é `role="group"` com `aria-label` = título, para os testes.
  - Gráficos (Recharts, `ResponsiveContainer`, cores `var(--chart-1)`…): títulos "Conversas por dia", "Funil do pipeline", "IA × transferências"; série vazia (todos zero / funil vazio) → "Sem dados no período".
  - Banner quando `has_activity === false`: texto exato "Ainda não há dados. Conecte um canal para começar a receber conversas." + link "Conectar canal" → `/configuracoes`.
  - Remover o parágrafo de estado vazio antigo.

- [ ] **Step 1: e2e que falha** — completar `dashboard.spec.ts`:

```ts
const kpi = (page, name) => page.getByRole("group", { name });
test("organização nova mostra banner e zeros", async ({ page }) => {
  await expect(page.getByText("Ainda não há dados. Conecte um canal para começar a receber conversas.")).toBeVisible();
  await expect(kpi(page, "Conversas hoje")).toContainText("0");
  await expect(kpi(page, "Taxa de resolução")).toContainText("—");
  await expect(page.getByText("Sem dados no período").first()).toBeVisible();
});
test("dashboard com dados mostra os números esperados (7 dias)", async ({ page }) => {
  // seedDashboardData(email); page.goto("/dashboard")
  await expect(page.getByText("Ainda não há dados.", { exact: false })).toBeHidden();
  await expect(kpi(page, "Conversas hoje")).toContainText("2");
  await expect(kpi(page, "Novos contatos")).toContainText("2");
  await expect(kpi(page, "Leads")).toContainText("3");
  await expect(kpi(page, "Oportunidades")).toContainText("1");
  await expect(kpi(page, "Valor potencial")).toContainText("R$ 1.000,00");
  await expect(kpi(page, "Atendidas por IA")).toContainText("1");
  await expect(kpi(page, "Transferências para humanos")).toContainText("1");
  await expect(kpi(page, "Taxa de resolução")).toContainText("50,0%");
  await expect(kpi(page, "Conversão")).toContainText("50,0%");
});
test("trocar para 30 dias atualiza cards e URL", async ({ page }) => {
  await page.getByRole("radio", { name: "30 dias" }).click();
  await expect(page).toHaveURL(/periodo=30d/);
  await expect(kpi(page, "Novos contatos")).toContainText("3");
  await expect(kpi(page, "Novos contatos")).toContainText("últimos 30 dias");
});
test("erro mostra Tentar novamente e recupera", async ({ page }) => {
  breakDashboardRpc();
  try {
    await page.getByRole("radio", { name: "Hoje" }).click();
    await expect(page.getByText("Não foi possível carregar o dashboard.")).toBeVisible();
  } finally { restoreDashboardRpc(); }
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(kpi(page, "Conversas hoje")).toContainText("2");
});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Instalar `recharts@^3` e implementar.**
- [ ] **Step 4: Rodar e ver passar** — e2e completo (duas vezes seguidas), typecheck, lint, build; `npm test`; `npm run db:reset; npm run db:test`.
- [ ] **Step 5: Commit** — `feat(web): dashboard KPIs, charts, period selector and states`

---

### Task 10: Acessibilidade dos formulários de auth e onboarding

**Files:**
- Modify: `apps/web/src/components/auth/signup-form.tsx`, `login-form.tsx`, `apps/web/src/components/onboarding/create-organization-form.tsx`
- Modify: `apps/web/e2e/auth.spec.ts`, `onboarding.spec.ts`

**Interfaces:**
- Produces: cada campo com erro tem `aria-invalid="true"` e `aria-describedby` apontando para o `id` da mensagem (`<campo>-error`); erros de **campo** aparecem só inline (sem toast); toast só para erros gerais do servidor (e-mail duplicado, credenciais inválidas, rate limit, inesperado), que também aparecem inline no `role="alert"` do formulário. Remover os `.first()` dos testes que existiam por causa da duplicação de campo.

- [ ] **Step 1: e2e que falha**

```ts
test("erro de campo é ligado ao input e não vira toast", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Nome completo").fill("Ana");
  await page.getByLabel("E-mail").fill("x@flowai.test");
  await page.getByLabel("Senha").fill("123");
  await page.getByRole("button", { name: "Criar conta" }).click();
  const senha = page.getByLabel("Senha");
  await expect(senha).toHaveAttribute("aria-invalid", "true");
  await expect(senha).toHaveAccessibleDescription("A senha deve ter pelo menos 8 caracteres.");
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar** — e2e completo, typecheck, lint, build.
- [ ] **Step 5: Commit** — `fix(web): accessible form errors without duplicate announcements`
