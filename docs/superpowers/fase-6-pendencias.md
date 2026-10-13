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
- **Chaves do cache de conhecimento:** `["knowledge", orgId]` com invalidação por prefixo, para não mostrar dados de outra organização por um instante.
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
- **Filas/banco:** `ai_usage_daily` tem `select` em nível de tabela e policy sem o invólucro `(select …)`; linha "venenosa" cujo `ai_job_gave_up` falha ficaria `running` com aviso a cada 5 s (as funções atuais não levantam erro); chunks sem chaves dão 23502 em vez de 22023; job inexistente com token retorna "obsoleto"; `lastMessageId` apagado entre preparar e completar vira 22023, retry e `ai_failure`; `factCheck` sem limite de tamanho; `contact.stage` sem ordenação.
- **Interface (a triar na revisão final):** `document-dialog.tsx` mostra erro antes dos dados, então uma falha de refetch em segundo plano durante a edição desmonta o formulário e perde o que foi digitado; no Playground, erros 403/400 viram texto genérico, a linha de uso não atualiza após teste que falhou, aparece "Somente administradores" quando a organização não tem agente, e o formulário não é resetado após salvar; o aviso de transferência no Inbox permanece após "Assumir" ou fechar até devolver/reabrir (consistente com o modelo, confirmar UX); faltam testes de componente para os estados de `/conhecimento` (cobertos pelo e2e).
- **Scripts de teste:** `test-ai-e2e.mjs` mascara chaves `sb_secret_` só parcialmente (apenas se o proxy falhar ao subir); no Windows o sinal só encerra o CLI do Playwright; o SQL cru da spec poderia ir para o helper `local-db`. O schema estrito do `openai.ts` remove `minimum/maximum/pattern/format` (o Zod revalida).
- **Ambiente local:** o analytics/vector local segue desligado em `supabase/config.toml` (host de 8 GB). Para `test:ai:e2e` e `test:instagram:e2e` é preciso definir `DENO_BIN` e `DENO_DIR` (sem eles o proxy não sobe).

## Evidências finais (HEAD a7698f7 + docs)

Executadas em sequência, uma por vez (host de 8 GB), sem nova tentativa em nenhuma suíte:

- `npm test`: 268 passando (core 209 em 23 arquivos, web 59 em 10 arquivos).
- `npm run typecheck`: sem erros. `npm run lint -w apps/web`: sem erros.
- `npx supabase db reset` + `npx supabase test db`: 38 arquivos, 1040 testes, PASS.
- `npm run test:edge` (Deno 2 local): 104 passando, 0 falhas.
- `npm run e2e -w apps/web` (build de produção): 64/64 em 5,6 min.
- `npm run test:ai:e2e` (stub local da OpenAI): 6/6 em 1,3 min.
- `npm run test:instagram:e2e` (proxy Graph local): 70/70 em 6,6 min.
- Crons ao final (`select jobname, active from cron.job`): `flowai-ai-worker`, `flowai-instagram-cleanup` e `flowai-instagram-worker`, todos ativos.
