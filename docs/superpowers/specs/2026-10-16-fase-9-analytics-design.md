# Fase 9 — Analytics (Design do Módulo de Análises)

- **Data:** 2026-10-16
- **Status:** aguardando aprovação
- **Branch:** `feat/fase-9-analytics`
- **Spec de referência:** [MVP Design](2026-10-07-flowai-mvp-design.md) (Seções 10 e 10.1)

---

## 1. Visão Geral e Objetivos

O módulo de **Analytics** (`/analytics`) é a central analítica aprofundada do FlowAI. Enquanto o **Dashboard** funciona como um resumo executivo rápido dos últimos 7 ou 30 dias, o **Analytics** oferece aos gestores e analistas:

1. **Visão Temporal Ampla & Comparativa:**
   - Filtros de período: Hoje (`1d`), 7 dias (`7d`), 30 dias (`30d`) e 90 dias (`90d`).
   - Comparativo dinâmico com o período anterior (delta percentual positivo/negativo) para identificar tendências de crescimento ou queda.
2. **Três Dimensões Analíticas Especializadas:**
   - **Atendimento e Conversas:** Volume total, taxa de resolução ao longo do tempo, tempo até fechamento e distribuição por canal (Instagram Direct, Simulador, etc.).
   - **Inteligência Artificial & Automação:** Volume de interações da IA, taxa de contenção/resolução sem humano vs transferências (`handoffs`), e motivos/intenções de transferência.
   - **Vendas, CRM & Funil:** Geração de novos contatos vs qualificação como lead, valor total transacionado, ticket médio, distribuição por etapa do funil e taxa de conversão final (`won` ÷ `created`).
3. **Exportação de Dados:**
   - Exportação rápida em CSV dos dados tabulares consolidados do período selecionado para relatórios externos de diretoria.
4. **Respeito à Privacidade e Isolamento:**
   - Todas as métricas respeitam o fuso horário da organização ativa (`timezone`), calculadas estritamente sob as regras de RLS do multi-tenancy.
   - Estado vazio informativo: quando a conta não tiver movimentação no período, explica o que cada indicador mede e orienta os primeiros passos sem gráficos vazios ou quebrados.

---

## 2. Arquitetura e Modelo de Dados

### 2.1 Fonte de Verdade

As métricas do Analytics são calculadas a partir das tabelas transacionais e do log imutável de eventos:
- `public.events`: `message_received`, `ai_replied`, `handoff`, `contact_created`, `deal_created`, `deal_won`, `conversation_closed`.
- `public.conversations`: estado atual (`open`, `waiting`, `closed`), canal e atribuição.
- `public.contacts`: total de contatos, status (`lead`, `customer`, `archived`) e score de lead.
- `public.deals`: valores e etapas do pipeline de vendas.

### 2.2 Função SQL de Métricas Analíticas (`public.analytics_metrics`)

Para garantir alto desempenho e eliminar múltiplas idas e vindas de rede, criamos a função SQL estável:
```sql
public.analytics_metrics(p_org uuid, p_days int, p_channel_id uuid default null) returns jsonb
```

Parâmetros:
- `p_org`: ID da organização ativa (validado com `is_member(p_org)`).
- `p_days`: 1, 7, 30 ou 90 dias.
- `p_channel_id` (opcional): filtro específico por canal ou nulo para todos os canais.

Retorno (JSONB validado por Zod):
```ts
{
  period_days: number;
  period_label: string;
  has_activity: boolean;
  summary: {
    total_conversations: number;
    conversations_trend: number | null; // % vs período anterior
    resolution_rate: number | null;
    resolution_trend: number | null;
    new_contacts: number;
    contacts_trend: number | null;
    new_leads: number;
    total_pipeline_value: number;
    won_deals_value: number;
    conversion_rate: number | null;
    ai_containment_rate: number | null;
  };
  conversations_section: {
    daily_volume: Array<{ day: string; received: number; resolved: number }>;
    by_channel: Array<{ channel_id: string; channel_name: string; channel_type: string; count: number }>;
    by_status: Array<{ status: "open" | "waiting" | "closed"; count: number }>;
  };
  ai_section: {
    daily_ai_vs_human: Array<{ day: string; ai_replied: number; handoffs: number }>;
    total_ai_messages: number;
    total_handoffs: number;
    top_handoff_reasons: Array<{ reason: string; count: number }>;
  };
  crm_section: {
    funnel: Array<{ stage_id: string; stage_name: string; position: number; count: number; value: number }>;
    daily_deals: Array<{ day: string; created: number; won: number }>;
    avg_ticket: number;
  };
}
```

---

## 3. Interfaces do Usuário (`/analytics`)

### 3.1 Cabeçalho e Controles
- Título da página: **Analytics**.
- Subtítulo: *"Indicadores de atendimento, inteligência artificial e conversão de vendas."*
- Barra superior de ferramentas:
  - **Seletor de Período:** botões/tabs `Hoje`, `7 dias`, `30 dias` e `90 dias`.
  - **Filtro de Canal (opcional):** dropdown permitindo isolar métricas de um canal Instagram específico ou Simulador.
  - **Botão Exportar CSV:** faz download imediato do consolidado do período (`analytics-[periodo]-[data].csv`).

### 3.2 Seção de Indicadores Principais (KPI Cards)
Grid de 4 cartões com comparativo de tendência:
1. **Conversas Totais** (com delta % vs período anterior).
2. **Taxa de Resolução** (conversas fechadas / ativas no período).
3. **Taxa de Contenção da IA** (% resolvida sem transição para humano).
4. **Conversão de Vendas & Receita Ganha** (% deals ganhos e valor total).

### 3.3 Abas Temáticas
Para facilitar a leitura profunda sem sobrecarregar a tela, a página divide as análises em 3 abas principais:
1. **Atendimento (`tab=conversations`):**
   - Gráfico de Linha/Área: Volume de conversas recebidas vs finalizadas por dia.
   - Gráfico de Rosca/Pizza: Distribuição por canal e status atual das conversas.
   - Tabela comparativa por canal com taxa de resolução.
2. **Inteligência Artificial (`tab=ai`):**
   - Gráfico de Barras Empilhadas: Mensagens da IA vs Transferências (`Handoffs`).
   - Painel de Eficiência da IA: Tempo médio estimado economizado e motivos de transição mais comuns.
3. **Pipeline & Vendas (`tab=crm`):**
   - Gráfico de Funil: Queda e volume de leads e negócios por etapa.
   - Gráfico de Evolução: Negócios criados vs negócios fechados com sucesso.
   - Métricas de ticket médio e valor total do pipeline.

---

## 4. Segurança e Permissões

- Todas as consultas utilizam `getActiveOrg()` no lado do servidor.
- Membros com papéis `owner`, `admin` ou `agent` podem visualizar métricas consolidadas da sua própria organização. Usuários não autorizados recebem redirect ou erro 403.
- Isolamento total entre tenants garantido pela cláusula `where organization_id = p_org` e checagem `is_member(p_org)`.
