# FlowAI — Fase 2: Layout + Dashboard — Design

- **Data:** 2026-10-09
- **Status:** aguardando revisão
- **Base:** spec do MVP (`2026-10-07-flowai-mvp-design.md`, seções 10 e 10.1) e pendências da Fase 1 (`docs/superpowers/fase-1-pendencias.md`)
- **Branch:** `feat/fase-2-layout-dashboard` (criado a partir de `feat/fase-1-fundacao`)

---

## 1. Objetivo e entendimento

Entregar o "esqueleto" do produto e o primeiro módulo de valor:

1. **App shell** — sidebar com os 9 módulos, cabeçalho, tema claro/escuro, responsivo — que todas as fases seguintes reutilizam.
2. **Emissão de eventos pelo banco** — gatilhos que registram os eventos de domínio que alimentam métricas (decisão pendente da Fase 1: eventos só por código definer).
3. **Dashboard** — 9 indicadores da spec 10.1, seletor de período e 3 gráficos simples, com estados de loading/erro/vazio.

### Decisões do brainstorming
| Tema | Decisão |
|---|---|
| Módulos não construídos | Todos os 9 itens visíveis; os não construídos abrem a rota final com estado "Em construção" |
| Identidade visual | Neutra/profissional, destaque índigo, logo textual "FlowAI"; tokens em variáveis CSS |
| Tema | Claro, escuro e "sistema" (padrão), com alternância no cabeçalho |
| Período | Hoje / 7 dias / 30 dias; padrão 7 dias; na URL (`?periodo=hoje|7d|30d`) |
| Gráficos | Conversas por dia (barras); funil do pipeline (barras horizontais); IA × transferências por dia (linhas) |
| Métricas | Abordagem A: gatilhos no banco gravam `events`; função SQL `dashboard_metrics` calcula tudo |

### Premissas
- Ainda não existem canais/conversas reais: o dashboard aparece zerado com o banner de primeiros passos até as Fases 3–5. Testes provam as métricas inserindo dados no banco local (nunca na UI).

### Critério de aceitação da fase
- Usuário logado vê a sidebar com os 9 itens, navega para qualquer módulo (os não construídos mostram "Em construção"), alterna tema e usa o app no celular.
- Dashboard mostra os 9 indicadores corretos para dados conhecidos, os 3 gráficos e troca de período; sem dados mostra o banner; erro mostra "Tentar novamente".
- Critério 19 do MVP ("dashboard registra os eventos") passa a ser verdadeiro para contato, conversa, mensagem, transferência, encerramento e deals.

---

## 2. App shell

### 2.1 Estrutura
- `apps/web/src/app/(app)/layout.tsx`: sidebar + área principal com cabeçalho.
- **Sidebar**
  - Topo: logo textual "FlowAI".
  - Itens (ordem fixa, ícones `lucide-react`):

    | Item | Rota | Ícone |
    |---|---|---|
    | Dashboard | `/dashboard` | `LayoutDashboard` |
    | Inbox | `/inbox` | `Inbox` |
    | Contatos | `/contatos` | `Users` |
    | Pipeline | `/pipeline` | `KanbanSquare` |
    | Automações | `/automacoes` | `Workflow` |
    | IA | `/ia` | `Bot` |
    | Conhecimento | `/conhecimento` | `BookOpen` |
    | Analytics | `/analytics` | `BarChart3` |
    | Configurações | `/configuracoes` | `Settings` |

  - Item ativo = rota atual ou sub-rota (destacado com a cor de destaque e `aria-current="page"`).
  - Rodapé: nome da organização + papel do usuário em pt-BR (Owner → "Proprietário", Admin → "Administrador", Agent → "Agente", Viewer → "Visualizador").
- **Cabeçalho**: título da página, botão de tema (Claro / Escuro / Sistema), menu do usuário (nome, e-mail, "Sair").
- **Responsivo**
  - ≥ 1024px: sidebar fixa (largura ~240px), recolhível para só ícones (~64px); estado salvo no cookie `flowai_sidebar` (`expanded|collapsed`), lido no servidor para evitar "pulo" visual.
  - < 1024px: sidebar vira gaveta (sheet) aberta por botão de menu no cabeçalho; fecha ao navegar.
- Navegação é uma lista central tipada (`apps/web/src/lib/navigation.ts`) usada pela sidebar, pelos títulos do cabeçalho e pelas páginas "em construção".

### 2.2 Páginas "Em construção"
- Cada módulo não construído tem sua rota final com uma página que usa o componente compartilhado `ModulePlaceholder`: ícone do módulo, título, uma frase do que o módulo fará (texto definido na lista central de navegação) e selo "Em construção".
- Textos (sem números nem dados de exemplo):
  - Inbox — "Todas as conversas de WhatsApp e Instagram em um só lugar."
  - Contatos — "Seus clientes e leads com histórico, tags e responsável."
  - Pipeline — "Acompanhe oportunidades de venda por etapa."
  - Automações — "Crie fluxos automáticos de atendimento e vendas."
  - IA — "Configure o agente de IA que atende seus clientes."
  - Conhecimento — "Documentos que a IA usa para responder com precisão."
  - Analytics — "Relatórios detalhados de atendimento e vendas."
  - Configurações — "Organização, equipe e integrações."

### 2.3 Tema
- `next-themes` com `attribute="class"`, `defaultTheme="system"`, `enableSystem`.
- Tokens em `globals.css` (`:root` e `.dark`): paleta neutra (zinc/slate) e `--primary` índigo; cores dos gráficos `--chart-1..5` derivadas para ambos os temas.

### 2.4 Segurança e convenções
- Convenção registrada (README + comentário em `active-org.ts`): **toda página e Server Action de `(app)` chama `getActiveOrg()` por conta própria**; o layout não é barreira de segurança.
- O layout passa ao cliente apenas `{ orgName, role, userName, userEmail }`.

### 2.5 Pendências da Fase 1 incluídas
- `resolveActiveOrg`: desempate determinístico por `organizationId` quando `createdAt` empata (com teste).
- Acessibilidade dos formulários de auth/onboarding: `aria-describedby` ligando campo ↔ mensagem; erro de campo apenas inline (sem toast duplicado); toast só para erros gerais do servidor.
- `log_auth_event` com rate limit: no máximo 30 chamadas por usuário por hora (`check_rate_limit('auth_event:' || uid, 30, 3600)`); acima disso a chamada não grava e não falha o login.

---

## 3. Eventos de domínio

### 3.1 Função interna
`public.emit_event(p_org uuid, p_type text, p_conversation_id uuid, p_contact_id uuid, p_deal_id uuid, p_payload jsonb default '{}')` — `SECURITY DEFINER`, `search_path = ''`, sem execute para `anon`/`authenticated`. Define `actor_type` = `'user'` e `actor_id = auth.uid()` quando houver usuário autenticado; senão `actor_type = 'system'`, `actor_id = null`.

### 3.2 Gatilhos (AFTER, `FOR EACH ROW`)
| Tabela / condição | Evento | Payload |
|---|---|---|
| `contacts` INSERT | `contact_created` | `{source}` |
| `conversations` INSERT | `conversation_created` | `{channel_id}` |
| `conversations` UPDATE, `status` muda para `pending_human` (ou INSERT já em `pending_human`, com `from_status: null`) | `handoff` | `{from_status}` |
| `conversations` UPDATE, `status` muda para `closed` (ou INSERT já em `closed`, com `from_status: null`) | `conversation_closed` | `{from_status}` |
| `messages` INSERT, `direction='inbound'` e `is_internal_note=false` | `message_received` | `{message_id}` |
| `messages` INSERT, `sender_type='ai'` | `ai_replied` | `{message_id}` |
| `deals` INSERT | `deal_created` | `{stage_id, value}` |
| `deals` UPDATE, `stage_id` muda | `deal_stage_changed` | `{from_stage_id, to_stage_id}` |
| `deals` UPDATE, `status` muda para `won` | `deal_won` | `{value}` |
| `deals` UPDATE, `status` muda para `lost` | `deal_lost` | `{value}` |

Conversa/contato/deal relacionados são preenchidos nas colunas `conversation_id`, `contact_id`, `deal_id` de `events` quando conhecidos.

### 3.3 Status do deal segue a etapa
Gatilho `BEFORE INSERT OR UPDATE OF stage_id` em `deals`: etapa `is_won` → `status='won'`; `is_lost` → `status='lost'`; demais → `status='open'`. (O índice único "um deal aberto por contato/pipeline" continua valendo.)
Mudar `is_won`/`is_lost` de uma etapa (gatilho `AFTER UPDATE OF is_won, is_lost` em `pipeline_stages`) recalcula o status dos deals da etapa, emitindo `deal_won`/`deal_lost` quando aplicável; se reabrir um deal violar o índice único, a mudança da flag falha com `23505`.

`organizations.timezone` é validado contra `pg_timezone_names` (`public.is_valid_timezone`, CHECK `organizations_timezone_valid`).

---

## 4. Métricas

### 4.1 Função
`public.dashboard_metrics(p_org uuid, p_days int) returns jsonb` — `SECURITY INVOKER` (RLS se aplica), `stable`, `search_path = ''`; `grant execute` só para `authenticated`.
- `p_days` ∈ {1, 7, 30}; outro valor → erro `22023`.
- Não membro → erro `42501` (checagem explícita com `is_member`).
- Janela: início = meia-noite (no `organizations.timezone`) de `hoje - (p_days - 1)`; fim = agora. "Hoje" usa sempre a meia-noite de hoje no fuso da org.

### 4.2 Retorno
```json
{
  "period_days": 7,
  "has_activity": true,
  "kpis": {
    "conversations_today": 0,
    "new_contacts": 0,
    "leads": 0,
    "opportunities": 0,
    "potential_value": 0,
    "ai_handled_conversations": 0,
    "handoffs": 0,
    "resolution_rate": null,
    "conversion_rate": null
  },
  "series": {
    "conversations_per_day": [{ "day": "2026-10-03", "count": 0 }],
    "ai_vs_handoff_per_day": [{ "day": "2026-10-03", "ai": 0, "handoff": 0 }]
  },
  "funnel": [{ "stage_id": "…", "name": "Novo", "position": 0, "count": 0, "value": 0 }]
}
```

### 4.3 Definições (refinam a spec 10.1)
| Indicador | Cálculo |
|---|---|
| `conversations_today` | conversas distintas com `message_received` desde a meia-noite de hoje (fuso da org) |
| `new_contacts` | eventos `contact_created` na janela |
| `leads` | contatos com `status='lead'` (agora) |
| `opportunities` | deals `open` cuja etapa tem `position > 0` no pipeline padrão (agora) |
| `potential_value` | soma de `value` dos deals `open` com `currency = 'BRL'` (agora); deals em outra moeda não somam |
| `ai_handled_conversations` | conversas distintas com `ai_replied` na janela |
| `handoffs` | eventos `handoff` na janela |
| `resolution_rate` | conversas distintas com `message_received` na janela **e** `conversation_closed` na janela ÷ conversas distintas com `message_received` na janela; `null` se denominador 0 (sempre em [0,1]) |
| `conversion_rate` | deals distintos com `deal_created` na janela **e** `deal_won` na janela ÷ deals distintos com `deal_created` na janela; `null` se denominador 0 (sempre em [0,1]; ganhos repetidos do mesmo deal contam uma vez) |

- Séries: um ponto por dia da janela (dias sem movimento = 0), datas no fuso da org.
- Funil: todas as etapas do pipeline padrão em ordem, com quantidade (todas as moedas) e soma de valor (só `currency = 'BRL'`) dos deals cujo `stage_id` é a etapa (snapshot atual, inclui Ganho/Perdido).
- `has_activity`: existe ao menos um evento na organização (qualquer data) ou ao menos um canal com `status='active'`.

---

## 5. Tela do Dashboard

- Rota `/dashboard?periodo=hoje|7d|30d` (inválido ou ausente → `7d`).
- **Cabeçalho da página**: título "Dashboard", nome da organização, seletor de período (segmentado: "Hoje", "7 dias", "30 dias").
- **Cards** (grade 4 / 2 / 1 colunas): título, valor e legenda.

  | Título | Formato | Legenda |
  |---|---|---|
  | Conversas hoje | inteiro | "desde 00h" |
  | Novos contatos | inteiro | período ("hoje", "últimos 7 dias", "últimos 30 dias") |
  | Leads | inteiro | "agora" |
  | Oportunidades | inteiro | "agora" |
  | Valor potencial | moeda BRL | "agora" |
  | Atendidas por IA | inteiro | período |
  | Transferências para humanos | inteiro | período |
  | Taxa de resolução | percentual 1 casa (`null` → "—") | período |
  | Conversão | percentual 1 casa (`null` → "—") | período |

- **Gráficos** (Recharts, cores `--chart-*`): "Conversas por dia" (barras), "Funil do pipeline" (barras horizontais, quantidade; valor no tooltip), "IA × transferências" (2 linhas). Sem dados na janela → texto "Sem dados no período" no lugar do gráfico.
- **Banner de primeiros passos** quando `has_activity = false`: "Ainda não há dados. Conecte um canal para começar a receber conversas." + botão "Conectar canal" → `/configuracoes`.
- **Dados**: carregamento inicial no servidor (Server Component chama a RPC); troca de período via React Query no cliente chamando um Route Handler `GET /api/dashboard?periodo=…` que valida a sessão/org e chama a RPC (sem service role).
- **Estados**: loading = esqueleto dos cards e gráficos; erro = mensagem "Não foi possível carregar o dashboard." + botão "Tentar novamente" (refetch); sucesso = dados.

---

## 6. Testes

- **Vitest** (`packages/core` ou `apps/web/src/lib`): formatação pt-BR (inteiro, BRL, percentual, "—"); parse do período (inválido → `7d`); transformação das séries/funil para o formato dos gráficos.
- **pgTAP**: cada gatilho gera exatamente um evento correto (tipo, ids, payload, ator); eventos não são gerados para nota interna; status do deal segue a etapa; `emit_event` não executável por `authenticated`; `dashboard_metrics` com dados conhecidos (cada KPI, séries com dias zerados, funil), virada de dia no fuso `America/Sao_Paulo`, divisão por zero → `null`, `p_days` inválido → 22023, não membro → 42501, isolamento entre orgs.
- **Playwright**: sidebar com 9 itens e navegação para página "Em construção"; alternância de tema persiste após reload; gaveta no viewport móvel; dashboard vazio com banner; dashboard com dados inseridos no banco local mostrando os números esperados; troca de período atualiza os cards; erro simulado mostra "Tentar novamente" e recupera.

---

## 7. Fora do escopo
Filtros avançados e séries longas (Analytics — Fase 9); página real de Integrações (Fase 5) e de Configurações; convites e gestão de membros; troca de organização.
