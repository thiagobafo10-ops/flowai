# Correções da revisão do MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Executar tarefas sequencialmente, com TDD, revisão independente e verificações proporcionais.

**Goal:** Corrigir os sete achados da revisão do MVP no HEAD `5be55be`, sem afirmar homologação não comprovada.

**Architecture:** Preservar os componentes, RPCs e regras multiempresa existentes. Corrigir Analytics por migration adicional; corrigir contratos do gerador e da paginação; tornar as evidências de aceitação comportamentais e os documentos honestos.

**Tech Stack:** Next.js 16, TypeScript, Supabase/PostgreSQL, Vitest, pgTAP, Deno, Playwright.

**Requirements:** Achados reproduzidos na revisão: agregação aninhada e coluna `events.metadata` inexistente; ticket médio com populações diferentes; contenção subtraindo conversas alheias à IA; JSON mode sem instrução JSON; sanitizador removendo saídas de fechamento e respostas rápidas; paginação ignorando offset; jornada que não executa critérios declarados homologados.

## Restrições

- Branch local `codex/mvp-review-fixes`; não fazer push, merge ou deploy.
- Não modificar migrations já versionadas. Criar `20261016000002_analytics_metrics_fix.sql` após a original e testes `051_analytics_metrics.test.sql`.
- Sem reset/exclusão do banco: aplicar migrations adicionais localmente e usar fixtures transacionais. Nenhuma chamada paga ou real à Meta/OpenAI.
- Preservar RLS, membership, papéis, escopo de organização/canal, limites de período e contratos de resposta.
- Suítes sequenciais neste host de 8 GB. Compilação/navegador somente com memória suficiente. Registrar bloqueios, sem alterar timeouts de produção.
- Ler `apps/web/AGENTS.md` e os guias Next instalados antes de editar o app.
- Seguir as regras de conexão/handles do core como autoridade; não criar um segundo conjunto divergente de regras.

### Task 1: Analytics executável e métricas coerentes

Files: nova migration `supabase/migrations/20261016000002_analytics_metrics_fix.sql`, novo pgTAP `supabase/tests/database/051_analytics_metrics.test.sql`.

- [ ] Reproduzir em pgTAP os erros da RPC original e cálculos incorretos, instalando a função original localmente sem reset quando necessário.
- [ ] Agrupar motivos de handoff antes de montar JSON; usar `events.payload`, com top cinco ordenado e estável, inclusive conjunto vazio.
- [ ] Ticket médio: somar e contar a mesma população de negócios ganhos no período; ancorar em eventos de vitória para não contar mera edição posterior. Testar negócio criado antes/ganho hoje e combinação com novo ganho; definir duplicidade de eventos sem contar negócio duas vezes.
- [ ] Contenção: proporção das conversas com resposta IA que não possuem handoff relevante no período; testar uma conversa IA sem handoff e outra somente humana, e handoff na própria conversa IA.
- [ ] Testar execução real da RPC, shape aceito pelo schema core, períodos, filtros de canal, isolamento e acesso negado.
- [ ] Aplicar adicional sem apagar dados; pgTAP focado RED→GREEN e suíte completa pertinente; commit e relatório.

### Task 2: Gerador de IA e paginação de campanhas

Files: `packages/core/src/automation/ai-generator.ts` e testes, `apps/web/src/lib/automation/ai-actions.ts` e testes, `apps/web/src/app/api/campanhas/[id]/route.ts` e testes relacionados.

- [ ] Teste de contrato da chamada OpenAI: contexto sempre instrui JSON com shape correto, mesmo com prompt padrão e em refinamento; manter JSON mode ou schema compatível. Sem API real.
- [ ] Testes: grafo válido `close_conversation → end` permanece válido; saídas `opt:*`/`no_reply` de respostas rápidas mantêm suas ramificações; sanitização não aceita handles/refs inválidos.
- [ ] Corrigir prompt e sanitizador usando regras canônicas do domínio e verificar grafo final com o validador.
- [ ] Interpretar limit/offset da URL com validação inteira e limites coerentes com o RPC. Testar página 0 e 1, valores inválidos e negativos, excesso e ausência de parâmetros; preservar autorização.
- [ ] RED→GREEN focado; unitários, tipos e lint pertinentes; commit e relatório.

### Task 3: Aceitação comportamental e documentação

Files: `apps/web/e2e/mvp-journey.spec.ts`, suporte/config/harness local apenas se necessário, `docs/superpowers/fase-10-mvp-conclusao.md`, `security-checklist.md`, README e documentos de evidência afetados.

- [ ] Converter critérios declarados em asserções reais ou classificá-los explicitamente como smoke/pendentes: classificação preenchida, pergunta enviada e RAG relevante retornado, resposta IA persistida/mostrada, fluxo ativado/executado, métricas com valores coerentes e CSV realmente baixado/conferido.
- [ ] Usar harness local com Graph/OpenAI falsos e restauração de crons/configurações existente; sem afirmar aceitação de fornecedores reais. Reutilizar cenários comportamentais existentes quando cobrem o requisito, registrando o mapa de evidências em vez de duplicar suítes.
- [ ] Corrigir afirmações falsas da checklist (por exemplo search_path efetivo, script não é suíte Edge, rate limits) após comparar com código; remover homologação de produção e datas/evidências inventadas.
- [ ] Executar jornada/casos relevantes quando memória permitir; registrar comando, contagem, resultado e limitações. Unitários, scripts, Edge, tipos/lint e pgTAP completos ao final conforme deltas.
- [ ] Revisão final independente das correções; commit. Integrações reais e rollout permanecem pendentes e explícitos.

## Revisão prévia

Tasks 1/2 não compartilham arquivos de implementação, mas são executadas sequencialmente para reduzir custo e conflitos. Task 3 consome os contratos corrigidos e verifica o resultado, sem alterar seu domínio. Migrations adicionais preservam a aplicação em bancos que já receberam a versão defeituosa. Cada tarefa tem ciclo RED/GREEN e gate independente.
