# Fase 7A — decisões, pendências e evidências

Referências: [design](specs/2026-10-13-fase-7a-automacoes-design.md) e [plano](plans/2026-10-13-fase-7a-automacoes.md). Validação local não confirma comportamento de uma app Meta ou uma conta OpenAI real.

## Decisões de implementação e revisão

- Horários comerciais exigem dias únicos e início anterior ao fim; turnos que atravessam a meia-noite ficaram fora da 7A.
- Comentários Instagram começam com um bloco de texto diretamente após o gatilho. Condições, CRM e IA podem vir depois de uma resposta do contato. Nenhum caminho sem resposta pode alcançar outra mensagem. Conta é validada na ativação; existência/posse da publicação é verificada no envio.
- O primeiro comentário recebe UUID estável sem execução disponível para o worker. A execução estacionada só é criada no claim após verificação; só envio confirmado libera a espera. Falhas e envios sem confirmação permanecem explícitos, sem repetir a primeira resposta. Mensagem inicial sem opções retoma pelo caminho padrão ao vencer a espera, limitado pelo validador.
- Cliques assinados adulterados ou de execução de outra organização/contato são ignorados atomicamente com a ingestão. Cliques autênticos vencidos (execução que não aguarda mais, outro bloco, opção removida, prazo vencido) entram como texto comum, sem payload e marcados `staleClick`: aparecem no Inbox e seguem o caminho normal (IA, novos gatilhos), mas nunca retomam a espera atual pelo título (onda final). Títulos digitados sem payload continuam válidos. O Simulador usa `click_automation_button` (agent+), que chama o núcleo privado sem trocar a identidade da sessão, com o contato da própria conversa.
- Autoria passa por RPCs; escrita direta por authenticated é negada. Ativação retorna `{activated, issues}`. Modelos usam a primeira conta Instagram, etiqueta e etapa aberta da organização; referências ausentes e URL de exemplo impedem ativação tanto no editor quanto nas ações de servidor.
- Execuções e passos referenciam o grafo da versão congelada, sem FK ao rascunho editável. Excluir automação apaga suas execuções e histórico. Reativar cria versão nova mesmo sem alterações.
- Uma execução ativa por conversa. Gatilhos CRM usam `FOR UPDATE SKIP LOCKED`: uma conversa ocupada ou travada pode fazer o evento ser descartado. Efeitos de automação em etiqueta/etapa emitem eventos com ator automação e não iniciam outra automação.
- Execuções de contato podem vincular uma conversa aberta livre. Sem conversa, envio termina com `no_conversation`; conversa ocupada, `conversation_busy`. Transferir para humano ou IA e Encerrar conversa concluem a execução e liberam a conversa; as transferências não têm saída no editor e Encerrar conversa só pode ser seguido de Fim (`after_close`). Reexecutar exige conversa livre.
- Mensagens acima do limite no momento do envio concluem com `reply_too_long`, sem mensagem (Instagram 1000 bytes; Simulador 4096 caracteres). O resultado aparece no histórico.
- Worker checa o orçamento entre passos persistidos e antes de efeitos externos, e conclui/aplica o efeito já iniciado. `yield_automation_run` retorna para pending, remove lease e desconta a tentativa de scheduling sem mudar versão, posição, entrada ou espera. Retoma no próximo tick; a antiga proposta de esperar lease expirar foi substituída. Limite total de passos também é checado antes da rede.
- Transporte de resposta privada aceita o mesmo corpo estruturado usado no Direct, mantendo compatibilidade com chamadas textuais existentes.
- Webhook de saída exige HTTPS, verifica todos os registros A/AAAA, bloqueia endereços internos/especiais, não segue redirects e limita tempo/corpo. O fetch usa a URL original para TLS/SNI: há janela residual de DNS rebinding sem pinning de IP. Qualquer porta pública é permitida.
- Contagens de execuções usam `automation_run_counts` SECURITY INVOKER; passos são carregados ao expandir cada execução, com limite de 200 e aviso de truncamento.
- Não existia evento de domínio `tag_added`: a 7A o adiciona (gatilho na inserção do vínculo contato-etiqueta); `save_contact` compara etiquetas para não reemiti-lo. `stage_changed` escuta `deal_stage_changed`/`deal_created`.
- O validador aceita o código extra `dangling_edge` (aresta de/para nó inexistente).
- `prepare` do worker devolve o contexto `ai` do nó atual ou de um sucessor direto do tipo IA (aditivo).
- Execuções em nível de contato (sem conversa) são criadas por correspondência de gatilho; a regra de uma execução ativa por conversa é aplicada ao vincular uma conversa.
- `ingest_inbound_message` de 7 argumentos (sem default; a versão de 6 passa `'{}'`) retorna NULL para payloads de clique adulterados ou de outra organização/contato; os chamadores tratam esse retorno. O clique do Simulador (`click_automation_button`) continua respondendo `not_waiting` para cliques vencidos, sem gravar mensagem.
- Regras de comentário antigas são substituídas por automações. Os testes de navegador passaram a usar o editor, mantendo posse da publicação, token, janela, resposta privada e idempotência.

## Onda final de correções (revisão do branch, base d681fa2)

Migration `20261013000009_automation_final_fixes.sql`, pgTAP `045_automation_final_fixes.test.sql`, guia [automation-setup.md](automation-setup.md).

- **Crítico:** o worker chamava `fail_automation_run` com `p_error_code`; o parâmetro SQL é `p_code` (PostgREST 404, falhas nunca gravadas). Corrigido no worker e no proxy E2E; teste de contrato (`supabase/functions/tests/rpc-contract.test.ts`) compara os argumentos de todas as chamadas `rpc(...)` dos workers com a assinatura mais recente de cada função nas migrations.
- IA × automação: `ai_reply_eligible` exige que a conversa não tenha execução pending/running/waiting; uma tarefa da IA já em curso quando a automação assume é descartada (`complete_ai_reply`/`handoff_ai_job` devolvem `skipped` e cancelam).
- Mensagem final sem resposta: `handoff_ai` e execuções retomadas por texto digitado (sem `optionId`) que terminam sem enviar nada depois enfileiram a IA (Fase 6: `run_after = now() + 4 s`) quando a conversa é elegível e a última mensagem do contato é mais nova que qualquer resposta enviada (mensagens de sistema não contam; empate de horário não enfileira). Conversas criadas pela resposta privada de comentário continuam `handled_by = 'human'` (regra da Fase 5), então nelas a IA só responde se a conversa já era da IA.
- Blocos terminais: transferências sem saída (`requiredHandles` = []; conexão vira `extra_handle`); `after_close` ("Nada é executado depois de fechar a conversa.") quando algo além de Fim segue Encerrar conversa; no banco, `close_conversation` também conclui a execução. O modelo "Qualificar lead com botões" termina na transferência.
- `contains` casa palavra/frase inteira (limites `[[:alnum:]_]`, como `instagram_keyword_matches`) no core e no SQL, inclusive nas regras migradas ("sim" não casa com "assim"; "link" não casa com "linkedin").
- Conversas com humano não iniciam execuções novas (mensagem recebida e eventos de CRM); retomadas continuam. Definição usada: `status = 'pending_human'`, ou `handled_by = 'human'` numa organização com IA ativa (`is_active` e `auto_reply`). Sem IA ativa toda conversa nasce `handled_by = 'human'`; tratar isso como "humano" impediria qualquer automação nessas organizações.
- Parar automação fecha o passo em espera; automação pausada ou excluída não prepara nem reserva resposta privada da fila (regressão do navegador `instagram.spec.ts` "pausar automação antes do worker"; paridade com a Fase 5). Reativar volta a enviar a resposta com a versão congelada.
- Botões no Instagram: texto do template ≤ 640 caracteres (core `toInstagramMessage` e validador `button_text_too_long_instagram`; no worker vira falha `invalid_content`).
- `handoff_human` grava `handoff_reason = 'automation'` (novo código; rótulo "Automação transferiu para atendimento humano" no core e no aviso do Inbox).
- Worker: SQLSTATE 40P01/40001 viram falha retentável `db_conflict`; webhook envia `iteration` no corpo e `Idempotency-Key: <runId>:<nodeId>:<iteration>`.
- Contratos de testes antigos ajustados: 042 (pausa não reserva; cliques autênticos vencidos viram texto; texto comum pode iniciar outro fluxo) e 026 (pausa descarta resposta privada da fila).

### Limitações conhecidas registradas nesta onda

- `{primeiro_nome}`/`{nome}` ficam vazios na primeira resposta privada de comentário: o contato ainda não existe (o nome do perfil só é buscado depois), então as variáveis são removidas com o espaço excedente.
- Corrida de boas-vindas em `contact_created`: na ingestão o contato é criado antes da conversa, então a execução nasce em nível de contato (sem conversa) e só liga a conversa no primeiro envio; se a mesma mensagem iniciou outra automação (mensagem recebida/palavra-chave) na conversa, o envio de boas-vindas termina com `conversation_busy`. Contatos criados no CRM sem conversa terminam com `no_conversation`.
- Eventos de CRM descartados quando a conversa está travada por outra transação (`FOR UPDATE SKIP LOCKED`): o evento não inicia execução e não há aviso.

## Validação ao vivo pendente

- Meta: assinatura/entrega de postbacks e respostas rápidas reais, assinatura/escopo de payload, subscription `messaging_postbacks` e campos exigidos no painel da app.
- Meta: templates de botão aceitos em private replies, quick replies em resposta privada, janela de sete dias para o primeiro comentário e abertura/renovação da janela de 24 horas após clique/resposta.
- Meta: app review/permissões, tokens expirados/renovação, publicações excluídas ou não pertencentes à conta, rate limits, webhooks repetidos e envios sem confirmação.
- OpenAI: credenciais, modelos, dimensões de embedding, quota/custo/latência e comportamento de geração/transferência com conteúdo real. Os E2E usam fornecedor falso local.

## Melhorias adiadas pela revisão

- Tipos manuais do motor com casts em vez de inferência Zod; configuração inválida de condição e mistura de quick replies/botões URL merecem cobertura adicional. Fuso inválido pode produzir `RangeError`.
- Limite de bytes depende do validador/transportes; botões path podem preservar URL extra no schema; limites estruturais do grafo e UUIDs estritos merecem mais testes. Texto de erro `comment_needs_reply` pode confundir em primeiro bloco IA.
- `automation_runs.version` é nullable no schema e ids de nós não têm validação no banco; criação e motor devem continuar usando a versão congelada.
- SQL `unaccent` translitera mais caracteres que normalização NFD do core; comparação HMAC em SQL não é constante no tempo. UPDATE direto de contact_tags não emite tag_added.
- Rever ordem de locks de `automation_link_run` (conversa → jobs pending) contra `complete_ai_reply` (job → conversa). Gatilhos CRM simultâneos descartados não geram aviso de produto.
- Backoff de 90 s é inalcançável com as três tentativas atuais. Resposta durante pending por claim expirado pode não retomar uma espera. Predicado de conversa ocupada segue duplicado no dispatch.
- Faixas especiais 192.88.99.0/24 e 2001::/23 (fora Teredo) não são bloqueadas. NODATA do Deno não foi exercitado, embora falhe fechado. Porta pública livre e DNS rebinding residual precisam ser considerados antes de produção.
- Fixture SQL de autoria de comentários está repetida em cinco suites pgTAP. `automation_signed_reply` trava o run do payload antes de verificar a conversa; filtrar `conversation_id` no WHERE reduziria locks desnecessários.
- Corrida entre consulta de status e save nas ações de autoria ainda merece uma transação/RPC única.
- Editor re-renderiza todos os nós quando muda o Map de issues; aceitável em modelos pequenos. Layout genérico com espaçamento de 160 px pode sobrepor nós com três saídas (216 px). Guard do botão voltar do navegador não foi adicionado; regex de mensagens depende do inglês do Zod.
- Evento button_clicked do Simulador registra ator contato, sem auditar qual agent clicou. Rota de passos lê refs antes de verificar existência do run; contatos sem telefone usam chave sintética de lock.
- Primeira execução fria do Inbox na tarefa 13 teve falhas não capturadas e repetição 13/13; observar a verificação final da tarefa 14.

## Harness E2E, cancelamento e recuperação

- Graph e OpenAI falsos; Auth, REST, RLS, Realtime e RPCs reais do Supabase local. `npm run test:automation:e2e` roda seis cenários no Chromium, porta web 3103 e proxy 54328; `npm run test:instagram:e2e` reutiliza o mesmo runner (3101/54326).
- O runner recusa portas ocupadas, pausa os três workers e restaura configuração/Vault e estado ativo dos crons em finally, verificando a releitura.
- Cancelamento (Ctrl-C/SIGTERM/saída): espera até 15 s o Playwright encerrar o Next e os navegadores que possui, encerra à força só as árvores de processos que o próprio runner iniciou (`taskkill /t /f` no Windows; grupo de processos no POSIX) e restaura uma única vez, mesmo se a parada dos filhos falhar. Falha de restauração termina com código 1, não 130/143.
- Kill forçado (sem finally): antes de pausar os crons, o runner grava no Vault local o marcador `flowai_e2e_harness_state` com PID, horário e estado anterior (crons e configuração dos workers). A próxima execução de qualquer um dos dois runners restaura esse estado e remove o marcador antes de começar; se o PID do marcador ainda estiver vivo (e o marcador tiver menos de 6 h), recusa iniciar. Se a recuperação falhar, o marcador é mantido e o runner para. Limitação: até a próxima execução, os crons ficam pausados e os workers apontam para a configuração temporária do teste; para recuperar, execute o runner novamente (a recuperação acontece antes do proxy e do navegador; um Ctrl-C depois dela restaura normalmente) ou restaure manualmente `select cron.alter_job(...)`/`configure_*_worker` pelo conteúdo do marcador.
- Privilégios compartilhados alterados por fixtures (SELECT em `memberships`, EXECUTE em `dashboard_metrics`): o `globalSetup` de todas as configs Playwright os garante no início, e o runner os garante na restauração (fonte única `scripts/lib/default-grants.mjs`).
- `scripts/test-ai-e2e.mjs` (Fase 6) ainda usa o padrão antigo: `process.once` + `kill()` sem esperar a árvore e sem marcador; um kill forçado nele deixa os crons `flowai-ai-worker`/`flowai-instagram-worker` pausados até a próxima execução de um dos runners de automação/Instagram ou correção manual.
- `FLOWAI_E2E_SLOW_HOST=1` (somente fora de CI): timeout 60 s / expect 15 s para host local com pouca memória; padrões normais e de CI continuam 30 s / 5 s.
- Testes leves dos runners: `npm run test:scripts` (node:test; sem navegador nem banco).

## Evidências finais

Pendente — preenchido pelo controller após as execuções de navegador.

| Verificação | Resultado |
|---|---|
| `npm test` | pendente |
| `npm run test:scripts` | pendente |
| `npm run typecheck` | pendente |
| `npm run lint -w apps/web` | pendente |
| `npx supabase db reset && npx supabase test db` | pendente |
| `npm run test:edge` | pendente |
| `npm run e2e -w apps/web` | pendente |
| `npm run test:ai:e2e` | pendente |
| `npm run test:instagram:e2e` | pendente |
| `npm run test:automation:e2e` (2 execuções) | pendente |
| `select jobname, active from cron.job` (quatro jobs ativos) | pendente |
