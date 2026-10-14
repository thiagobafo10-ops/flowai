# Estado de verificação do MVP — FlowAI

- **Data desta revisão:** 14 de outubro de 2026.
- **Status:** correções locais em verificação; aceitação comportamental revisada ainda pendente de execução no navegador. Sem homologação de produção.
- **Referências:** [spec do MVP](specs/2026-10-07-flowai-mvp-design.md), [plano das correções](plans/2026-10-14-mvp-review-fixes.md), [checklist de segurança](security-checklist.md).

## Contratos de aceitação e evidência

`mvp-journey.spec.ts` é uma jornada smoke de 19 etapas com verificações de persistência de CRM e métricas. Os comportamentos de IA e automação usam cenários específicos existentes; a jornada não os substitui. Um teste escrito ou listado não comprova execução aprovada.

| Etapas | Contrato efetivamente verificado | Cenário |
|---|---|---|
| 1–2 | Cadastro redireciona ao onboarding; criação da organização leva ao dashboard e persiste uma membership | `mvp-journey.spec.ts` |
| 3 | Dashboard e cards visíveis (smoke); zeros iniciais têm caso específico | `mvp-journey.spec.ts`; `dashboard.spec.ts`: organização nova mostra banner e zeros |
| 4 | Configuração do agente salva e switches continuam ativos após reload | `mvp-journey.spec.ts` |
| 5 | Documento criado aparece na lista; indexação pronta com trecho é contrato separado | `mvp-journey.spec.ts`; `ai.spec.ts`: documento é indexado e fica pronto com um trecho |
| 6–9 | Simulador ativo, inbound criado, mensagem e contato mostrados após navegação | `mvp-journey.spec.ts` |
| 10 | Jornada mostra apenas rótulos; caso IA verifica intenção `duvida`, sentimento `neutral`, resumo e lead score 50 no banco/Inbox após reload | `ai.spec.ts`: classificação e resposta RAG persistem no banco e no Inbox e contam uso |
| 11 | Jornada apenas preenche formulário; caso IA envia pergunta, recebe R$ 200 e mostra o trecho Frete recuperado e uso do playground | `ai.spec.ts`: área de teste responde com trechos e conta o uso |
| 12 | Jornada mostra apenas cota; caso IA processa worker com provedor falso, persiste uma resposta baseada no documento, mostra texto e selo após reload e incrementa uso | `ai.spec.ts`: classificação e resposta RAG persistem no banco e no Inbox e contam uso |
| 13–14 | Lead score 85 conferido no banco e após reload; deal de R$ 250 mostrado no pipeline e contado pela RPC de métricas | `mvp-journey.spec.ts` |
| 15 | Jornada apenas mostra ações; cenário dedicado cria/configura/ativa fluxo, recebe inbound, mostra opções, executa ramo e persiste status `pending_human`, etiqueta e etapa | `automation.spec.ts`: Simulador mostra opções, bloqueia IA e transfere com etiqueta e etapa |
| 16 | Jornada cobre assunção manual; transferência automática por falta de conhecimento e devolução têm casos específicos | `mvp-journey.spec.ts`; `ai.spec.ts`: sem informação na base transfere para um atendente; devolver para IA remove o aviso e registra a mensagem de sistema |
| 17–18 | Mensagem humana exibida com entrega no Simulador; conversa encerrada, editor bloqueado e status `closed` conferido no banco | `mvp-journey.spec.ts` |
| 19 | RPCs autenticadas retornam valores coerentes com a jornada; download CSV lido e números confrontados com a API | `mvp-journey.spec.ts` |
| 19 (cenário discriminante) | Dois atendimentos, 50% resolução, 100% contenção mesmo com handoff em conversa só humana; pipeline R$ 1000, ganho/ticket R$ 500, status waiting/closed; CSV real com os mesmos números | `analytics.spec.ts`: métricas persistidas e CSV baixado refletem o mesmo período |

Os cenários usam Supabase local real (Auth, REST, RLS, eventos e persistência). OpenAI e Graph são falsos nas suítes de integração. Isso verifica a integração interna, sem demonstrar qualidade de embeddings/respostas reais, entrega Meta ou aceitação do cliente piloto.

## Como executar os contratos revisados

Execute sequencialmente, com memória disponível e Supabase local saudável, sem reset:

```bash
npm run test:mvp:e2e
npm run test:automation:e2e -- --grep "Simulador mostra opções"
```

O primeiro comando reúne jornada, IA e Analytics em um build de produção usando o proxy existente de IA (54327) e app (3102). O segundo reutiliza o harness de automações (54328/3103). O harness pausa os três workers, salva configurações e crons no marcador local do Vault, encerra apenas processos próprios e restaura configurações antes de reativar crons. Uma interrupção forçada é recuperada na próxima execução. Não compartilhe o banco com outra suíte durante esse processo. A jornada fica fora da configuração Playwright geral para exigir esse isolamento.

## Evidências desta revisão

| Comando / consulta | Resultado comprovado | Limite |
|---|---|---|
| `npm test` (correções 1–2, commit `03c146f`) | 603 aprovados: core 419 + web 184 | Evidência anterior às mudanças de aceitação; não é execução de navegador |
| `npx supabase test db` (correção 1, commit `c673cda`) | 2174 aprovados em 51 arquivos; 44 do contrato Analytics | Migrations adicionais aplicadas localmente, sem reset |
| `npm run test:scripts` | 17/17 aprovados, incluindo seleção IA e restauração com/sem configuração | Scripts node:test, não testes Edge nem navegador; Windows exigiu permissão para controlar processos próprios |
| Metadados locais PostgreSQL | 40/40 tabelas públicas com RLS, nenhuma FORCE RLS; 117 funções public definer com search_path vazio; nenhuma policy anon/PUBLIC | Consulta de metadados, sem alteração de dados ou leitura de segredos |
| `npm run test:mvp:e2e` | 10/10 aprovados (6 IA, 3 Analytics com download CSV, 1 Jornada 19 etapas) | Executado contra build de produção com proxy local Deno (54327) e workers pausados/restaurados |
| `npm run test:automation:e2e -- --grep "Simulador mostra opções"` | 1/1 aprovado | Execução de automação visual no Simulador via harness local (54328) |

As suítes são distintas: `npm run test:edge` executa Deno/Edge Functions; `npm run test:scripts` executa testes dos runners. Os registros históricos de 199 testes Edge e 13 testes de scripts não constituem uma nova execução desta revisão. O registro completo de comandos e verificações está no relatório local de Task 3 (`.superpowers/sdd/2026-10-14-mvp-review-fixes/task-3-report.md`).

## Limitações e entrada em produção

- Analytics usa o último evento de ganho de cada negócio dentro do período, com snapshot de valor quando disponível. Ganhos históricos sem `payload.value` recorrem ao valor atual do deal; alterações posteriores podem mudar esse histórico legado.
- Eventos de handoff do produtor atual registram `from_status`, sem motivo. A RPC usa o rótulo padrão `Solicitação do cliente` quando `payload.reason` falta; esse rótulo não comprova a causa real.
- Deals não têm canal próprio: o filtro de canal os associa aos contatos com conversa naquele canal. Um contato multicanal pode aparecer em mais de um filtro.
- Meta ao vivo, permissões/verificação do aplicativo, OpenAI real, custos/qualidade RAG, provisionamento Supabase de produção, segredos, teste do cliente piloto e rollout continuam pendentes.
- WhatsApp permanece adiado. Headers e testes locais não equivalem a auditoria ou homologação do ambiente publicado.
