# Fase 7A — decisões, pendências e evidências

Referências: [design](specs/2026-10-13-fase-7a-automacoes-design.md) e [plano](plans/2026-10-13-fase-7a-automacoes.md). Validação local não confirma comportamento de uma app Meta ou uma conta OpenAI real.

## Decisões de implementação e revisão

- Horários comerciais exigem dias únicos e início anterior ao fim; turnos que atravessam a meia-noite ficaram fora da 7A.
- Comentários Instagram começam com um bloco de texto diretamente após o gatilho. Condições, CRM e IA podem vir depois de uma resposta do contato. Nenhum caminho sem resposta pode alcançar outra mensagem. Conta é validada na ativação; existência/posse da publicação é verificada no envio.
- O primeiro comentário recebe UUID estável sem execução disponível para o worker. A execução estacionada só é criada no claim após verificação; só envio confirmado libera a espera. Falhas e envios sem confirmação permanecem explícitos, sem repetir a primeira resposta. Mensagem inicial sem opções retoma pelo caminho padrão ao vencer a espera, limitado pelo validador.
- Cliques assinados inválidos, expirados ou fora da organização/canal/contato/bloco/opção são ignorados atomicamente com a ingestão. Títulos digitados sem payload continuam válidos. O Simulador usa `click_automation_button` (agent+), que chama o núcleo privado sem trocar a identidade da sessão, com o contato da própria conversa.
- Autoria passa por RPCs; escrita direta por authenticated é negada. Ativação retorna `{activated, issues}`. Modelos usam a primeira conta Instagram, etiqueta e etapa aberta da organização; referências ausentes e URL de exemplo impedem ativação tanto no editor quanto nas ações de servidor.
- Execuções e passos referenciam o grafo da versão congelada, sem FK ao rascunho editável. Excluir automação apaga suas execuções e histórico. Reativar cria versão nova mesmo sem alterações.
- Uma execução ativa por conversa. Gatilhos CRM usam `FOR UPDATE SKIP LOCKED`: uma conversa ocupada ou travada pode fazer o evento ser descartado. Efeitos de automação em etiqueta/etapa emitem eventos com ator automação e não iniciam outra automação.
- Execuções de contato podem vincular uma conversa aberta livre. Sem conversa, envio termina com `no_conversation`; conversa ocupada, `conversation_busy`. Transferir para humano ou IA conclui a execução e libera a conversa; blocos seguintes não executam. Reexecutar exige conversa livre.
- Mensagens acima do limite no momento do envio concluem com `reply_too_long`, sem mensagem (Instagram 1000 bytes; Simulador 4096 caracteres). O resultado aparece no histórico.
- Worker checa o orçamento entre passos persistidos e antes de efeitos externos, e conclui/aplica o efeito já iniciado. `yield_automation_run` retorna para pending, remove lease e desconta a tentativa de scheduling sem mudar versão, posição, entrada ou espera. Retoma no próximo tick; a antiga proposta de esperar lease expirar foi substituída. Limite total de passos também é checado antes da rede.
- Transporte de resposta privada aceita o mesmo corpo estruturado usado no Direct, mantendo compatibilidade com chamadas textuais existentes.
- Webhook de saída exige HTTPS, verifica todos os registros A/AAAA, bloqueia endereços internos/especiais, não segue redirects e limita tempo/corpo. O fetch usa a URL original para TLS/SNI: há janela residual de DNS rebinding sem pinning de IP. Qualquer porta pública é permitida.
- Contagens de execuções usam `automation_run_counts` SECURITY INVOKER; passos são carregados ao expandir cada execução, com limite de 200 e aviso de truncamento.
- Regras de comentário antigas são substituídas por automações. Os testes de navegador passaram a usar o editor, mantendo posse da publicação, token, janela, resposta privada e idempotência.

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
- Job IA já running pode responder quando a automação começa. Rever ordem de locks de `automation_link_run` (conversa → jobs pending) contra `complete_ai_reply` (job → conversa). Gatilhos CRM simultâneos descartados não geram aviso de produto.
- Backoff de 90 s é inalcançável com as três tentativas atuais. Resposta durante pending por claim expirado pode não retomar uma espera. Predicado de conversa ocupada segue duplicado no dispatch.
- Faixas especiais 192.88.99.0/24 e 2001::/23 (fora Teredo) não são bloqueadas. NODATA do Deno não foi exercitado, embora falhe fechado. Porta pública livre e DNS rebinding residual precisam ser considerados antes de produção.
- Fixture SQL de autoria de comentários está repetida em cinco suites pgTAP. `automation_signed_reply` trava o run do payload antes de verificar a conversa; filtrar `conversation_id` no WHERE reduziria locks desnecessários.
- Corrida entre consulta de status e save nas ações de autoria ainda merece uma transação/RPC única.
- Editor re-renderiza todos os nós quando muda o Map de issues; aceitável em modelos pequenos. Layout genérico com espaçamento de 160 px pode sobrepor nós com três saídas (216 px). Guard do botão voltar do navegador não foi adicionado; regex de mensagens depende do inglês do Zod.
- Evento button_clicked do Simulador registra ator contato, sem auditar qual agent clicou. Rota de passos lê refs antes de verificar existência do run; contatos sem telefone usam chave sintética de lock.
- Primeira execução fria do Inbox na tarefa 13 teve falhas não capturadas e repetição 13/13; observar a verificação final da tarefa 14.

## Evidências locais

As contagens finais e o estado restaurado dos quatro crons serão registrados após a verificação sequencial da tarefa 14. Harness: Graph e OpenAI falsos; Auth, REST, RLS, Realtime e RPCs reais do Supabase local. `npm run test:automation:e2e` roda seis cenários no Chromium, porta web 3103 e proxy 54328. O runner recusa portas ocupadas, pausa os três workers e restaura configuração/Vault e estado ativo dos crons em finally. No cancelamento (Ctrl-C/SIGTERM/saída), espera até 15 s o Playwright encerrar o Next e os navegadores que possui, encerra à força só as árvores de processos que o próprio runner iniciou (`taskkill /t /f` no Windows) e restaura uma única vez. Os privilégios padrão alterados por fixtures (SELECT em `memberships`, EXECUTE em `dashboard_metrics`) são garantidos no início de cada execução (globalSetup e runner) e na restauração. Testes do coordenador: `node --test scripts/tests/owned-process.test.mjs`.
