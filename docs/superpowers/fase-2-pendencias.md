# Fase 2 — Decisões tomadas e pendências para as próximas fases

Registro gerado ao final da execução da Fase 2 (branch `feat/fase-2-layout-dashboard`). Complementa `fase-1-pendencias.md`. Cada decisão traz o custo se estiver errada.

## Decisões tomadas durante a execução

1. **Status do deal sempre derivado da etapa** — editar `status` direto é ignorado; o gatilho recalcula a partir da etapa. *Custo:* não dá para marcar um deal como ganho sem movê-lo para a etapa Ganho (a spec não pede isso).
2. **Mudar "Ganho/Perdido" numa etapa atualiza os deals dela**; se isso reabrir um deal de um contato que já tem outro deal aberto no pipeline, a mudança da etapa falha (erro 23505). *Custo:* o admin precisa resolver o deal duplicado antes.
3. **Taxas sempre entre 0% e 100%**:
   - Resolução = conversas com mensagem recebida no período que também foram fechadas no período ÷ conversas com mensagem recebida no período.
   - Conversão = deals criados no período que também foram ganhos no período ÷ deals criados no período; ganhar o mesmo deal duas vezes conta uma vez.
   - *Custo:* um deal criado antes do período e ganho dentro dele não entra na conversão.
4. **Valor potencial e valor do funil somam só deals em BRL** (as contagens incluem todas as moedas). *Custo:* deals em outra moeda não aparecem em valor até existir conversão de moeda.
5. **Fuso da organização validado pelo banco** (nomes IANA exatos, ex.: `America/Sao_Paulo`). *Custo:* grafias alternativas como `america/sao_paulo` ou `+03` são recusadas.
6. **Seletor de período atualiza a URL sem recarregar a página do servidor** (`history.replaceState`), para que o erro apareça dentro do dashboard com "Tentar novamente". *Custo:* casos raros de histórico do navegador.
7. **Seletor de período com navegação por setas** (padrão ARIA de grupo de opções).
8. **Testes e2e limpam o rate limit do banco local antes de cadastrar usuários.**
9. **Testes antigos do CRM ajustados** para apontar deals ganhos/perdidos para etapas Ganho/Perdido reais (sem enfraquecer o que verificam).

## Pendências por fase

**Antes da Fase 3 (convenções a manter)**
- Toda página/ação de `(app)` chama `getActiveOrg()`; páginas novas devem usar o componente `RequireOrg` envolvendo o conteúdo.
- O seletor "Hoje" usa `has_activity`; contatos manuais também contam como atividade (definição da spec).

**Fase 3 (CRM)**
- Ao reabrir um deal (tirar de Ganho/Perdido) não há evento "deal reaberto"; decidir se o funil/relatórios precisam disso.
- Índices nas colunas `events.contact_id` / `deal_id` (exclusões de contato/deal varrem `events`).
- Moeda: se houver deals em outras moedas, definir conversão ou separar valores por moeda.

**Fase 4/5 (Inbox e Meta)**
- Proxy ainda chama `auth.getUser()` em toda rota `/api/*`; rotas de webhook devem ficar fora do matcher.
- `has_activity` pode ficar verdadeiro por um canal marcado `active` pelo admin (já anotado na Fase 1: status do canal deve ser do service role).

**Fase 6 (IA)**
- `ai_replied` gerado pelo backend fica com autor "sistema"; derivar `actor_type = 'ai'` a partir do `sender_type`.

**Fase 9 (Analytics)**
- `dashboard_metrics` usa subconsultas por dia/etapa — trocar por `group by` quando o volume crescer.

**Fase 10 / antes do deploy**
- Três consultas de autenticação por navegação em `(app)` (proxy, `getActiveOrg`, layout) — expor o usuário por um helper com cache.
- Testes e2e: instabilidade no primeiro carregamento logo após `db:reset` (aguardar os containers ou rodar com `next start`).
- Contraste do índigo no modo escuro (~4,5:1) e item de tema ativo marcado só por peso da fonte — revisar no passe de acessibilidade.
- Erros de campo além do primeiro não são anunciados por leitor de tela; erros gerais são anunciados duas vezes (alerta + toast).
- Esqueleto de carregamento sem `role="status"`; troca de período mostra esqueleto inteiro (considerar manter os dados anteriores).

**Cosmético / quando conveniente**
- `sheet.tsx` copiado do shadcn com formatação diferente e exports sem uso; ordem de imports em `app-sidebar.tsx`; `eslint-disable` no `ThemeToggle`; comparador aninhado em `resolveActiveOrg`.
- Testes: alguns cenários de métricas usam contagens que coincidem (trocar o tipo de evento passaria); e2e cobre 2 das 8 páginas "Em construção".
