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

## Correção de métricas e limites (14 de outubro de 2026)

A migration adicional `20261016000002_analytics_metrics_fix.sql` corrige a execução da RPC, o agrupamento dos motivos via `events.payload`, o ticket médio e a contenção. `pending_human` é exposto como `waiting`. Filtro de canal é aplicado às seções; deals usam a associação de contato/conversa porque não têm canal próprio, podendo aparecer em mais de um filtro para contatos multicanal.

O ticket usa o último evento de ganho por deal dentro do período, com snapshot `payload.value`; ganhos históricos sem snapshot recorrem ao valor atual do deal. Eventos de handoff do produtor atual trazem `from_status`, sem motivo; na ausência de `payload.reason`, o ranking usa `Solicitação do cliente`, que não demonstra a causa real.

## Evidências e execução pendente

O contrato SQL corrigido aprovou 44 verificações focadas e a suíte pgTAP aprovou 2174 verificações em 51 arquivos, com migrations adicionais instaladas localmente sem reset. Após as correções 1–2, os unitários aprovaram 603 testes (419 core + 184 web). Essas são verificações locais e não demonstram desempenho ou aceitação em produção.

O caso original `analytics.spec.ts` cobria navegação, períodos, abas e botão CSV habilitado; ele não baixava nem conferia o arquivo. O novo caso verifica números da API sobre eventos produzidos pelos gatilhos e lê o CSV realmente baixado, confrontando seus valores com os da API. **A execução desse contrato revisado no navegador está pendente de memória disponível.** Consulte o [mapa de aceitação e evidências](fase-10-mvp-conclusao.md) para comandos e estado atualizado. Scripts do harness e testes Edge são suítes distintas.
