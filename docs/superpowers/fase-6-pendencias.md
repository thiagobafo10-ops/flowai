# Fase 6 — IA: execução e pendências

Branch `feat/fase-6-ia`; base `3cb5751`. Escopo: atendimento por IA com base de conhecimento (RAG) no Simulador e no Instagram, área de teste, transferência para humano e limites diários. [Guia de configuração](ai-setup.md).

## Estado

Tarefas 1–13 concluídas, cada uma com revisão independente. Fica pendente a validação ao vivo com uma chave real da OpenAI; nenhum teste chama a OpenAI nem a Graph API reais (a OpenAI é substituída por um stub local nos testes de navegador).

## Decisões de execução

- **Zod nas Edge Functions:** `supabase/functions/deno.json` mapeia `zod` para `npm:zod@4.6.5`, para o código compartilhado funcionar em Deno e Node.
- **Falha fecha para o lado seguro:** se há resposta mas faltam a checagem de fatos ou os limites de tamanho, a decisão é transferir (`ai_failure`). Números por extenso junto de valor, porcentagem ou duração só passam se o mesmo texto estiver na base. Custo: algumas transferências desnecessárias.
- **Tentativas:** 3 no total; a espera de 90 s da lista de intervalos nunca é usada (inofensiva). Se uma falha com nova tentativa encontra outra tarefa pendente para a mesma conversa, a antiga é encerrada como cancelada, porque a pendente relê o estado atual. Isso evita resposta duplicada e conflito no índice único da fila.
- **Esgotou tentativas / varredura:** a transferência registra status, nota de sistema e evento, mas **não** cria o aviso "Vou te encaminhar…" nem no Instagram nem no Simulador, porque nesse caminho não há worker para enviá-lo.
- **Tarefa sem linha de job:** `complete_ai_reply` e `handoff_ai_job` retornam "ignorado" (como o caso "obsoleto" da indexação). Custo: um defeito do worker pode parecer um simples skip.
- **Migrations ainda não aplicadas fora da branch:** as tarefas 4 e 7 corrigiram suas próprias migrations (`…016` e `…018`) em vez de criar novas; isso só vale porque nunca foram aplicadas em outro lugar.
- **Fase 1/4 atualizadas:** testes antigos que gravavam em `knowledge_documents` direto como `authenticated` agora afirmam a negativa e usam `save_knowledge_document`; asserções que supunham "resposta humana deixa `handled_by='ai'`" mudaram, pois o humano que responde assume a conversa; asserções de "Em construção" em `/ia` e `/conhecimento` viraram os títulos das páginas novas.
- **`ai-worker` com `verify_jwt=true`** (o plano dizia `false`), igual ao `instagram-worker`; o cron envia o JWT de serviço.
- **Papel `viewer`** passou a poder consultar o status da IA no Playground (aditivo).
- **Chaves do cache de conhecimento:** `["knowledge", orgId]` com invalidação por prefixo, para não mostrar dados de outra organização por um instante. O documento em edição usa `["knowledge-doc", orgId, id]`, fora desse prefixo, para que invalidações da lista e do Realtime não o recarreguem no meio da edição.
- **Copy extra:** código 22023 "canal não suportado" mostra "A IA não atende conversas deste canal."
- **Atualização do painel de classificação:** depende de `complete_ai_reply` atualizar `conversations` na mesma transação (comentado no código), sem incluir `ai_classifications` na publicação realtime.
- **Teste de integração do Instagram:** `ai.spec.ts` está fora do `playwright.integration.config.ts` (que usa o proxy da Graph, não o da OpenAI); roda por `npm run test:ai:e2e`.
- **Fake da OpenAI nos e2e:** usa palavras irrelevantes ignoradas para atingir a similaridade mínima de 0,3; `test:ai:e2e` sobrescreve a configuração local do worker (como o script do Instagram).

## Pendências

- **Validação ao vivo com OpenAI:** `gpt-4.1-mini` como modelo padrão (qualidade, custo, JSON estruturado), embeddings reais com `min_similarity = 0,3` e k = 5, e o formato do vetor via PostgREST com a API real. Até lá o padrão é uma suposição.
- **Custo da classificação:** hoje a conversa é classificada a cada lote de mensagens agrupadas (uma chamada extra por resposta). Avaliar classificar só no primeiro lote ou por mudança de contexto.
- **Heurística de injeção:** baseada em padrões; tem falsos positivos conhecidos (ex.: "pode ignorar tudo acima, já resolvi" gera transferência) e lacunas (sem detector pt-BR para "aja como um <papel>"; frases comuns como "esqueça tudo" foram restringidas). É camada de defesa, não garantia.
- **Checagem de fatos:** datas como "24/7" e "1/2" são lidas como data; "dia 20" contra "20/11" e "um dia desses" falham fechado (seguro, porém ruidoso). Prefixo "Sistema:" no início de linha pode casar com texto comum.
- **Chunking:** corte duro não separa pares substitutos Unicode com cuidado; divisão de frases em parágrafos longos junta quebras de linha; testes de sobreposição e corte são frouxos.
- **Prompt:** nome/tags do contato com quebra de linha não são normalizados dentro de `<contact>`; o embedding é validado depois da chamada de classificação.
- **Lacunas de teste e detalhes menores das tarefas 1, 3 e 5:** o `refine` do Playground gera erro duplicado com lista vazia; faltam testes de fronteira para resumo, `handoff_reason`, 1000 caracteres e 10 mensagens; o teste de truncamento do histórico usa uma mensagem sentinela (msg-4 em vez de msg-14); não há teste de que as tentativas voltam a zero ao regravar (upsert) nem de exclusão de embeddings NaN.
- **Filas/banco:** `ai_usage_daily` tem `select` em nível de tabela e policy sem o invólucro `(select …)`; linha "venenosa" cujo `ai_job_gave_up` falha ficaria `running` com aviso a cada 5 s (as funções atuais não levantam erro); chunks sem chaves dão 23502 em vez de 22023; job inexistente com token retorna "obsoleto"; `lastMessageId` apagado entre preparar e completar vira 22023 e `ai_failure` (sem nova tentativa, como todo 22023 ao completar); `factCheck` sem limite de tamanho; `contact.stage` sem ordenação.
- **Interface:** no Playground, respostas não-2xx da função (403/400) viram o texto genérico e o código do erro se perde; a linha de uso só é atualizada após teste bem-sucedido; quando a organização não tem agente, aparece "Somente administradores podem testar o agente". O aviso de transferência no Inbox permanece após "Assumir" ou fechar até devolver/reabrir (consistente com o modelo, confirmar UX). Faltam testes de componente para os estados de `/conhecimento` (cobertos pelo e2e).
- **Cota diária conta só respostas enviadas:** transferências e novas tentativas não consomem a cota; uma organização com muitas transferências pode gastar chamadas da OpenAI além do limite de respostas. Avaliar contar tentativas ou chamadas.
- **Aviso de transição conta como resposta da IA:** "Vou te encaminhar para um atendente, só um instante." é gravado como mensagem da IA e entra na métrica `ai_replied`. Avaliar separar o aviso das respostas.
- **Scripts de teste:** `test-ai-e2e.mjs` mascara chaves `sb_secret_` só parcialmente (apenas se o proxy falhar ao subir); no Windows o sinal só encerra o CLI do Playwright; o SQL cru da spec poderia ir para o helper `local-db`. O schema estrito do `openai.ts` remove `minimum/maximum/pattern/format` (o Zod revalida).
- **Ambiente local:** o analytics/vector local segue desligado em `supabase/config.toml` (host de 8 GB). Para `test:ai:e2e` e `test:instagram:e2e` é preciso definir `DENO_BIN` e `DENO_DIR` (sem eles o proxy não sobe).

## Correções da revisão final

- **Uma resposta por conversa por vez:** `claim_ai_jobs` não reserva uma tarefa `reply` pendente enquanto outra `reply` da mesma conversa está `running` com reserva válida (`claimed_until > now()`); reservas vencidas são devolvidas pela varredura. Evita respostas duplicadas ou fora de ordem e cota em dobro.
- **Resposta em branco:** `decideHandoff` trata resposta vazia ou só com espaços como transferência (`no_knowledge` sem trechos, senão `needs_human`). O worker trata 22023 vindo de `complete_ai_reply`/`complete_index_document` como resultado inválido (`invalid_result`, sem nova tentativa), sem gastar mais chamadas da OpenAI.
- **Edição de documento:** o formulário aparece sempre que há dados (mesmo com erro de refetch posterior) e a consulta saiu do prefixo `["knowledge"]`.
- **Injeção:** todas as mensagens do contato depois da última resposta da IA ou do atendente são verificadas, não só a última.
- **Ordem de travas:** `return_to_ai` trava as tarefas `reply` em curso/pendentes da conversa antes da conversa (mesma ordem de preparar/completar/desistir).
- **`max_tokens`:** 300 na classificação e 800 na resposta.
- **Realtime:** mudanças em mensagens/conversas invalidam só as consultas do Inbox; mudanças em documentos, só a base de conhecimento (debounces separados).

## Evidências finais (branch `feat/fase-6-ia`, cabeça que inclui o commit de documentação)

Executadas em sequência, uma por vez (host de 8 GB), sem nova tentativa em nenhuma suíte.

Após as correções da revisão final:

- `npm test`: 279 passando (core 215 em 23 arquivos, web 64 em 12 arquivos).
- `npm run typecheck`: sem erros. `npm run lint -w apps/web`: sem erros.
- `npx supabase db reset` + `npx supabase test db`: 38 arquivos, 1047 testes, PASS.
- `npm run test:edge`: 110 passando, 0 falhas.
- `npm run test:ai:e2e`: 6/6.
- `npx playwright test inbox inbox-realtime` (provider do Realtime alterado): 13/13. A suíte completa e `test:instagram:e2e` não foram repetidas nesta rodada.

Antes das correções:

- `npm test`: 268 passando (core 209 em 23 arquivos, web 59 em 10 arquivos).
- `npm run typecheck`: sem erros. `npm run lint -w apps/web`: sem erros.
- `npx supabase db reset` + `npx supabase test db`: 38 arquivos, 1040 testes, PASS.
- `npm run test:edge` (Deno 2 local): 104 passando, 0 falhas.
- `npm run e2e -w apps/web` (build de produção): 64/64 em 5,6 min.
- `npm run test:ai:e2e` (stub local da OpenAI): 6/6 em 1,3 min.
- `npm run test:instagram:e2e` (proxy Graph local): 70/70 em 6,6 min.
- Crons ao final (`select jobname, active from cron.job`): `flowai-ai-worker`, `flowai-instagram-cleanup` e `flowai-instagram-worker`, todos ativos.
