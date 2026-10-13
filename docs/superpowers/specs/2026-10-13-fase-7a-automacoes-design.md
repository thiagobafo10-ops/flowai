# Fase 7A — Automações: motor, editor visual e recursos de conversa do ManyChat

- Data: 2026-10-13.
- Status: design aprovado pelo usuário em seções (2026-10-13); aguardando revisão da spec escrita.
- Base: Fases 1–6 no `master` (`f1d4d03`), design geral do MVP (§8) e roadmap (paridade com ManyChat).

## Resultado esperado

O admin cria automações num editor visual, com gatilhos de mensagem, palavra-chave, comentário do Instagram, story, contato, tag e etapa, e blocos de mensagem (inclusive com botões e respostas rápidas), IA, condição, espera e ações de CRM. Um motor persistente executa cada fluxo sem repetir passos, retoma após falhas e esperas, e tem prioridade sobre a IA enquanto o fluxo está ativo na conversa. As regras de comentário da Fase 5 passam a ser automações.

## Decisões do usuário (2026-10-13)

1. **Fase 7 dividida:** 7A (esta) = motor, editor, gatilhos e ações da spec, gatilhos de comentário e story, botões e respostas rápidas. 7B (spec própria, depois) = links e QR de entrada, sequências de vários dias, mensagens em massa segmentadas.
2. **Automação tem prioridade sobre a IA:** com uma execução ativa ou aguardando resposta na conversa, a IA não responde; ao terminar, a IA volta a atender. O fluxo pode terminar com "passar para a IA" ou "passar para humano".
3. **Regras de comentário viram automações:** migração das regras existentes; a seção antiga em Canais vira link para Automações.
4. **Arquitetura A:** fila no banco + `automation-worker` (Edge Function, pg_cron a cada 5 s, padrão das Fases 5 e 6) + motor puro em `packages/core`. Editor com React Flow (`@xyflow/react`).

## Escopo

**Dentro:** gatilhos e blocos abaixo; validador; motor; worker; esperas até 7 dias; aguardar clique com prazo; envio no Simulador e Instagram (incluindo resposta privada a comentário); webhook seguro; histórico de execuções com reexecução; versões de automação; migração das regras de comentário; telas `/automacoes`, editor e ajustes no Inbox e em Canais; três modelos prontos.

**Fora:** links e QR de entrada, sequências de vários dias e mensagens em massa (7B); criador de automações por IA (Fase 8); mídia em mensagens; esperas acima de 7 dias; testes A/B; WhatsApp.

## 1. Gatilhos

Um gatilho por automação:
- `message_received` — qualquer mensagem; opção "só a primeira mensagem da conversa".
- `keyword_detected` — lista de palavras/frases; modo `contains` | `equals` | `starts_with`; sem diferenciar maiúsculas e acentos.
- `instagram_comment` — palavras-chave como acima; um post/Reel específico (`media_id`) ou todos da conta; por canal.
- `instagram_story` — resposta ou menção em story; por canal.
- `contact_created`, `tag_added` (tag específica ou qualquer), `stage_changed` (etapa de destino específica ou qualquer).

`conversation_created` permanece no enum por compatibilidade, mas não aparece no editor.

## 2. Blocos

- **`message` (texto):** até 1000 bytes UTF-8 no Instagram e 4096 caracteres no Simulador; variáveis `{primeiro_nome}` e `{nome}` (vazias → removidas com o espaço excedente). Opcional: até 3 **botões** (título ≤ 20 caracteres; tipo `path` → saída própria do bloco, ou `url` → link HTTPS) **ou** até 13 **respostas rápidas** (título ≤ 20 caracteres, cada uma uma saída). Com botões `path` ou respostas rápidas, o fluxo **aguarda o clique** com prazo configurável (1 h a 7 dias, padrão 24 h) e saída `no_reply`. Mensagem digitada pelo cliente enquanto aguarda: segue pela saída `no_reply` imediatamente se não casar com o título de nenhuma opção (comparação sem acento/maiúsculas); se casar, segue pela opção.
- **`message` (IA):** roda o pipeline da Fase 6 (classificação, RAG, resposta, verificação) e consome a cota diária de respostas. Saídas `sent` e `handoff` (quando a IA decidiria transferir; nesse caso nada é enviado e o fluxo segue por `handoff`).
- **`condition`:** contém palavra (na última mensagem do cliente), tem tag, etapa atual, lead score ≥ N, intenção da última classificação igual a X, horário comercial (dias da semana e faixa de horas no fuso da organização). Saídas `true`/`false`.
- **`delay`:** 1 minuto a 7 dias.
- **Ações:** `tag`, `remove_tag`, `assign_user`, `move_stage` (qualquer etapa do pipeline padrão, inclusive Ganho/Perdido — escolha explícita do admin), `webhook`, `close_conversation`, `handoff_ai` (devolve a conversa à IA: `handled_by='ai'`, `status='open'`), `handoff_human` (`handled_by='human'`, `status='pending_human'`, motivo de sistema "Automação transferiu para atendimento humano").
- **`end`.**

Configuração de cada tipo validada por schema Zod em `packages/core/src/automation`.

## 3. Validador

Exatamente um gatilho; todos os blocos alcançáveis a partir dele; sem ciclos; toda saída de condição, botão `path`, resposta rápida, `no_reply`, `sent`/`handoff` ligada; configurações válidas; tags, etapas e atendentes existentes na organização; canal e post existentes para gatilhos do Instagram. Após um bloco `message` que é a primeira mensagem de um fluxo de comentário, o próximo bloco deve ser alcançado por botões/respostas rápidas (ou ser `end`) — regra da Meta: após a resposta privada, a próxima mensagem só pode sair depois que o cliente responder no Direct. Ativação exige grafo válido; salvar rascunho aceita grafo inválido.

## 4. Motor e execução

- **Disparo:** gatilhos SQL sobre `events` (e sobre os pontos de ingestão já existentes) escolhem a automação e criam `automation_runs` com `ON CONFLICT (automation_id, trigger_event_id) DO NOTHING`. Se várias automações ativas casarem, roda a mais antiga ativada (`activated_at`, depois `id`).
- **Mensagem recebida, nesta ordem:** (1) conversa com execução `waiting` aguardando clique/resposta → retoma essa execução; (2) senão, automação de mensagem/palavra-chave casada → nova execução; (3) senão, tarefa de resposta da IA da Fase 6. Com execução `pending`/`running`/`waiting` na conversa, a IA não é enfileirada.
- **Cliques:** no Instagram, postbacks e quick replies chegam pelo webhook com payload assinado (HMAC com segredo da instalação, contendo execução, bloco e opção; payload inválido é ignorado); no Simulador, o atendente clica no botão desenhado no balão. Ambos geram o evento `button_clicked` e retomam a execução.
- **Worker:** `automation-worker` acionado pelo cron a cada 5 s apenas quando há execuções vencidas; reserva com token e prazo de 3 min; lote de 3 por até ~100 s; varredura de reservas expiradas.
- **Motor puro:** `step(graph, nodeId, context, input) → { next, effects[], wait? }`. O worker aplica os efeitos e grava `automation_run_steps` (único por execução, bloco e iteração); após queda, retoma do último passo concluído. Máximo de 50 passos por execução.
- **Anti-loop:** mensagens `sender_type='automation'` não disparam gatilhos.
- **Envios:** Simulador grava direto; Instagram usa a fila de envio da Fase 5 (janela de 24h; mensagens com botões/respostas rápidas no formato da API do Instagram); a primeira mensagem de um fluxo de comentário segue o caminho de resposta privada da Fase 5 com suas verificações (comentário real, post da conta, até 7 dias, uma por comentário). Fora da janela de 24h → execução termina `completed` com resultado `window_closed` no passo.
- **Falhas:** webhook com 3 tentativas (backoff 10 s/30 s/90 s); outros erros → execução `failed` com código curto (sem texto de mensagem). "Reexecutar a partir deste passo" cria nova iteração a partir do bloco escolhido.
- **Cancelamento:** fechar a conversa ou "Parar automação" cancela execuções `pending`/`waiting` da conversa.
- **Versões:** editar uma automação ativa cria nova versão do grafo; execuções em andamento continuam na versão em que começaram.

## 5. Dados

Migrations novas (nunca editar as existentes):
- Enums ampliados: gatilhos `instagram_comment`, `instagram_story`; tipos de bloco `handoff_ai`, `handoff_human`.
- `automations`: `activated_at`, `current_version`; `automation_versions` (grafo congelado em jsonb por versão); `automation_runs.version` e campos de espera (`waiting_for` = `delay` | `reply`, `wait_node_id`).
- `conversations.automation_run_id` (execução ativa na conversa) — escrita só pelo serviço.
- Segredo de assinatura de payload em `private` (Vault).
- Migração das regras: cada `instagram_comment_rules` vira automação (`instagram_comment` → `message`), ativa → ativa, inativa → rascunho; a ingestão de comentários passa a consultar automações.
- RLS: membros leem automações, versões, execuções e passos da organização; escrita de automações por admin/owner via funções; execuções e passos só pelo serviço.

## 6. Telas

- **`/automacoes`:** lista (nome, gatilho, status, execuções nos últimos 7 dias, data); "Nova automação", "Duplicar", "Pausar/Ativar", "Excluir" com confirmação; estado vazio com três modelos: "Responder comentário com link", "Boas-vindas no Direct", "Qualificar lead com botões".
- **Editor `/automacoes/[id]`:** React Flow; paleta lateral; painel de configuração (RHF + Zod); botões e respostas rápidas como saídas do bloco; validação ao vivo com destaque e lista de erros; "Salvar rascunho" e "Ativar"; aba "Execuções" com passos, erros e "Reexecutar a partir deste passo".
- **Inbox:** selo "Automação"; botões no balão (clicáveis no Simulador); "Em automação: {nome}" com "Parar automação".
- **Canais:** seção de regras de comentário substituída por aviso e link "Gerenciar em Automações".
- **Permissões:** admin/owner criam, editam, ativam, reexecutam; agent vê e pode "Parar automação"; viewer só vê.

## 7. Segurança

- Webhook: só HTTPS; bloqueio de IPs privados, loopback e link-local, verificado após a resolução de DNS; timeout 10 s; resposta limitada a 64 KB; sem seguir redirecionamentos para hosts bloqueados.
- Payload de botões assinado; cliques forjados ou de outra organização são ignorados.
- Funções no padrão do projeto (definer com `search_path=''`, grants por coluna, RLS, sem `anon`); logs sem texto de mensagens.

## 8. Testes e definição de concluído

Nenhum teste chama Meta ou OpenAI reais.
- **core (Vitest):** motor (passos, condições, botões, prazo do clique, mensagem digitada durante a espera, esperas, limite de 50 passos), validador (cada regra), schemas, variáveis e formatação para o Instagram.
- **pgTAP:** disparo e escolha da automação; sem execução duplicada; prioridade sobre a IA; retomada por clique e por prazo; cancelamento ao fechar; versões; migração das regras; RLS e grants.
- **Edge (Deno):** worker com Instagram e IA falsos (envio, botões, resposta privada, janela de 24h); webhook (bloqueio de rede interna, novas tentativas); assinatura de payload.
- **Playwright:** montar "Qualificar lead com botões" no editor, ativar, simular mensagem, clicar no botão no Simulador e ver tag e etapa; fluxo de comentário com resposta privada pelo proxy do Instagram; espera retomada; "Parar automação".

Concluído quando todas as suítes passam (`npm test`, typecheck, lint, pgTAP, edge, e2e padrão, e2e da IA, e2e do Instagram e o novo e2e de automações), README atualizado e `fase-7a-pendencias.md` registra decisões e pendências (incluindo validação ao vivo de postbacks e quick replies com um app Meta real).
