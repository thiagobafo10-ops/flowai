# Fase 9 — Analytics (Decisões, pendências e evidências)

Referências: [design](specs/2026-10-16-fase-9-analytics-design.md) e [plano](plans/2026-10-16-fase-9-analytics.md).

---

## Decisões de implementação e arquitetura

1. **Central Unificada de Analytics (`/analytics`):**
   - Substituição do placeholder original da rota por um painel analítico completo, com suporte a filtros de períodos de 1 dia (`Hoje`), 7 dias, 30 dias e 90 dias.
   - Navegação estruturada em 3 abas temáticas desacopladas:
     - **Atendimento & Conversas:** Volume diário de conversas recebidas e resolvidas, distribuição por canal (Instagram / Simulador) e concentração por status (`open`, `waiting`, `closed`).
     - **Inteligência Artificial:** Respostas automáticas da IA vs escalonamentos para humanos (`handoffs`), taxa de contenção e ranking dos principais motivos de transferência.
     - **Vendas & Funil do CRM:** Funil horizontal por etapa com contagem de negócios e valor financeiro acumulado, gráfico de novos negócios vs ganhos e ticket médio.

2. **Função SQL Estável de Métricas (`public.analytics_metrics`):**
   - Implementada com segurança `invoker` e `search_path = ''`, garantindo respeito estrito às permissões de membership da organização ativa (`is_member(p_org)`).
   - Cálculo automático da janela comparativa anterior de mesma duração (`p_days`) para gerar variações percentuais (`trend`) confiáveis em cada KPI.
   - Timezone da organização respeitado em todas as conversões de datas locais e séries temporais (`generate_series`).

3. **Schemas e Validação Zod Compartilhada (`@flowai/core`):**
   - Schema estrito `analyticsMetricsSchema` garantindo que respostas da RPC sejam validadas em tempo de execução no frontend e backend.
   - Função utilitária `calculateTrendPercentage` com proteção contra divisão por zero.
   - Utilitário `formatAnalyticsCsv` gerando arquivos CSV compatíveis com Excel e ferramentas de BI (UTF-8 com BOM).

4. **Desempenho e Revalidação com TanStack Query:**
   - Server-side rendering (SSR) inicial dos dados em `/analytics` com reidratação imediata no cliente.
   - Cache de 30 segundos com invalidação sob demanda e botão de atualização manual sem recarregar a página.

---

## Validação ao vivo pendente

- **Escala de Eventos em Produção:**
  - Avaliação de performance da RPC `analytics_metrics` em organizações com mais de 50.000 eventos e dezenas de canais simultâneos; se necessário, avaliar índices cobrindo `events (organization_id, type, created_at)`.
- **Filtros Multi-Agente:**
  - Inclusão futura de filtro por operador/atendente humano responsável quando a plataforma expandir para distribuição de filas de atendimento.

---

## Tabela de Evidências dos Testes

| Suíte / Comando | Escopo | Resultado |
| :--- | :--- | :--- |
| `npm test -w @flowai/core` | 34 arquivos de teste (analytics schemas, trend calculation, layout, etc.) | **406 testes aprovados** (0 falhas) |
| `npm test -w apps/web` | 32 arquivos de teste (analytics queries, actions, growth, inbox, etc.) | **162 testes aprovados** (0 falhas) |
| `npm run test:scripts` | 1 arquivo de teste de harness | **13 testes aprovados** |
| `npm run typecheck` | Checagem estrita de tipos do TypeScript em todo o monorepo | **Aprovado com 0 erros** |
| `npm run lint -w apps/web` | Verificação de regras de código com ESLint 9 | **Aprovado com 0 avisos/erros** |
| `e2e/analytics.spec.ts` | Testes E2E de navegação, alternância de períodos, abas e exportação CSV | **Aprovado** |
