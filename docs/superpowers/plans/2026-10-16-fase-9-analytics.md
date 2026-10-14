# Fase 9 — Analytics (Plano de Implementação)

- **Data:** 2026-10-16
- **Branch:** `feat/fase-9-analytics`
- **Spec de referência:** [`docs/superpowers/specs/2026-10-16-fase-9-analytics-design.md`](../specs/2026-10-16-fase-9-analytics-design.md)
- **Metodologia:** TDD estrito com commits atômicos por tarefa.

---

### Task 1: Core — Schemas, tipos e funções de transformação de Analytics

**Files:**
- Create `packages/core/src/analytics/schemas.ts`
- Create `packages/core/src/analytics/schemas.test.ts`
- Create `packages/core/src/analytics/transform.ts`
- Create `packages/core/src/analytics/transform.test.ts`
- Modify `packages/core/src/index.ts`

**Interfaces:**
- `analyticsMetricsSchema`: Zod schema com período (`1d`, `7d`, `30d`, `90d`), resumo de KPIs, tendências em relação à janela anterior, conversas diárias, divisão por canal, IA vs handoffs e funil do CRM.
- `calculateTrendPercentage(current: number, previous: number)`: cálculo determinístico de variação percentual com tratamento de divisão por zero.
- `formatAnalyticsCsv(metrics: AnalyticsMetrics)`: formata as métricas consolidadas em CSV padrão (UTF-8 com BOM) para exportação.

**Passos:**
1. Escrever testes em `schemas.test.ts` e `transform.test.ts` esperando falha.
2. Implementar schemas, cálculo de tendências e serializador CSV.
3. Validar com `npm test -w @flowai/core`.
4. Commit: `feat(analytics): core schemas, types, trend calculation and CSV export`.

---

### Task 2: Database — Migration e função SQL `analytics_metrics`

**Files:**
- Create `supabase/migrations/20261016000001_analytics_metrics.sql`
- Create `supabase/tests/database/analytics-metrics.test.sql`

**Interfaces:**
- Função `public.analytics_metrics(p_org uuid, p_days int, p_channel_id uuid default null)`:
  - Validação de membership e timezone da organização.
  - Períodos permitidos: 1, 7, 30 e 90 dias.
  - Janela comparativa anterior do mesmo tamanho (`p_days` anteriores) para cálculo de deltas percentuais (`trend`).
  - Agregação de conversas recebidas e resolvidas por dia.
  - Agregação por canal e status (`open`, `waiting`, `closed`).
  - Atendimentos da IA vs transferências para humanos (`handoffs`).
  - Etapas do funil de vendas com contagem de deals e valor monetário.

**Passos:**
1. Escrever testes pgTAP validando o isolamento entre organizações e as agregações de métricas.
2. Criar a migration SQL com a função `analytics_metrics`.
3. Validar com `npm run db:test` (ou testes locais de migração).
4. Commit: `feat(analytics): SQL migration and analytics_metrics function`.

---

### Task 3: Web — Queries, Server Action e Endpoint de API `/api/analytics`

**Files:**
- Create `apps/web/src/lib/analytics/queries.ts`
- Create `apps/web/src/lib/analytics/queries.test.ts`
- Create `apps/web/src/app/api/analytics/route.ts`

**Interfaces:**
- `getAnalyticsMetrics(orgId: string, period: AnalyticsPeriod, channelId?: string)`: Server function invocando a RPC e validando saída com `analyticsMetricsSchema`.
- Route Handler `GET /api/analytics?periodo=30d&canal=...` para consumo via React Query no cliente.

**Passos:**
1. Escrever testes unitários em `queries.test.ts` com mock da RPC.
2. Implementar a query e o endpoint de API.
3. Validar com `npm test -w apps/web`.
4. Commit: `feat(analytics): web server queries and analytics API route`.

---

### Task 4: Web — Componentes de UI e Gráficos da Central de Analytics

**Files:**
- Create `apps/web/src/components/analytics/analytics-view.tsx`
- Create `apps/web/src/components/analytics/kpi-summary.tsx`
- Create `apps/web/src/components/analytics/conversations-tab.tsx`
- Create `apps/web/src/components/analytics/ai-tab.tsx`
- Create `apps/web/src/components/analytics/crm-tab.tsx`
- Create `apps/web/src/components/analytics/analytics-skeleton.tsx`
- Modify `apps/web/src/app/(app)/analytics/page.tsx`

**Interfaces:**
- Substituição do `<ModulePlaceholder />` em `/analytics` pela página completa com:
  - Seletor de período (Hoje, 7d, 30d, 90d);
  - Filtro por canal e botão de exportação CSV;
  - Grid de 4 cartões de KPIs com badges de tendência (positivo/negativo);
  - Três abas temáticas (Atendimento, Inteligência Artificial e Vendas/CRM);
  - Gráficos responsivos do Recharts e tabelas comparativas.

**Passos:**
1. Construir os componentes visuais e gráficos com os dados formatados do `@flowai/core`.
2. Validar tipos com `npm run typecheck -w apps/web` e `npm run lint -w apps/web`.
3. Validar com `npm test -w apps/web`.
4. Commit: `feat(analytics): analytics page view, tabs and charts`.

---

### Task 5: E2E, Documentação e Verificação Final da Fase 9

**Files:**
- Create `apps/web/e2e/analytics.spec.ts`
- Create `docs/superpowers/fase-9-pendencias.md`
- Modify `README.md`

**Passos:**
1. Implementar teste E2E Playwright navegando na página `/analytics`, alternando abas e períodos e testando o download do CSV.
2. Escrever documento de pendências e decisões da Fase 9.
3. Rodar suíte completa: `test:scripts`, `test`, `typecheck`, `lint` e `build`.
4. Commit: `test(analytics): e2e analytics suite, docs and verification`.
