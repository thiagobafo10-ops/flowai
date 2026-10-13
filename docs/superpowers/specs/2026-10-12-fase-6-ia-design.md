# Fase 6 — Agente de IA, base de conhecimento e RAG

- Data: 2026-10-12.
- Status: design aprovado pelo usuário em seções (2026-10-12); aguardando revisão da spec escrita.
- Base: Fases 1–5 no `master` (`b748df1`), design geral do MVP (§4.1, §7) e roadmap (paridade com ManyChat).

## Resultado esperado

O admin configura o agente de IA da empresa, cadastra documentos na base de conhecimento e testa o agente numa área de teste. Com o agente ativo, mensagens recebidas no Simulador e no Direct do Instagram são classificadas, respondidas em pt-BR com base apenas no conhecimento cadastrado e, na dúvida, transferidas para um humano com o motivo visível no Inbox. O contato entra no CRM com lead score e deal.

## Decisões do usuário (2026-10-12)

1. **Chave da plataforma:** uma única `OPENAI_API_KEY` nos segredos das Edge Functions; nunca no navegador nem em `apps/web`. Sem chave por empresa.
2. **Fontes da base:** texto colado e arquivos `.txt`/`.md`. PDF e sites ficam para a fase extra.
3. **Extras:** apenas a área de teste do agente. Sugestão de resposta ao atendente e resumo sob demanda ficam fora (candidatos futuros).
4. **Limite diário definido pela plataforma:** teto padrão por organização, alterável só pela plataforma; ao atingir, a conversa vai para humano com aviso. A área de teste tem teto próprio.
5. **Arquitetura A:** fila no banco + worker de IA em Edge Function acionado por `pg_cron`/`pg_net`, no padrão da Fase 5.

Propostas do implementador aprovadas nas seções: agrupamento de mensagens por 4 s, cron a cada 5 s, padrões 300 respostas e 30 testes por dia, 3 tentativas com espera crescente.

## Escopo

**Dentro:** configuração do agente (`/ia`), área de teste, base de conhecimento (`/conhecimento`), indexação com embeddings, `match_knowledge_chunks`, pipeline de resposta automática (classificação → RAG → resposta → verificação), transferência para humano, "Assumir"/"Devolver para IA" no Inbox, limite diário, estado "IA não configurada".

**Fora:** sugestão de resposta ao atendente, resumo sob demanda, PDF/sites, chave por empresa, múltiplos agentes, IA em comentários (continuam com as regras de palavra-chave da Fase 5), mídia.

## 1. Quando a IA atua

A IA responde uma conversa quando, no momento da execução:
- `conversations.handled_by = 'ai'` e `status <> 'closed'`;
- o agente da organização tem `is_active` e `auto_reply`;
- o canal é Simulador ou Instagram (Direct, inclusive respostas e menções em stories);
- há chave configurada e cota diária disponível.

Comentários de posts/Reels nunca geram tarefa de IA.

## 2. Fluxo de uma mensagem

1. `ingest_inbound_message` (e o caminho de ingestão do Instagram para Direct/stories), na mesma transação, faz upsert de **uma tarefa `reply` pendente por conversa** em `ai_jobs` com `run_after = now() + 4 s`. Nova mensagem antes da execução apenas adia `run_after`. A tarefa só é criada se as condições da §1 que dependem do banco (handled_by, agente ativo com auto_reply, canal elegível) forem verdadeiras.
2. `pg_cron` a cada 5 s executa `dispatch_ai_worker()`, que só chama o `ai-worker` via `pg_net` se houver tarefas vencidas. O worker esvazia a fila em lotes por até ~100 s, como o worker do Instagram.
3. O worker reserva a tarefa (`claim_ai_job`, com token de reserva e expiração) e recebe do banco o contexto: agente, empresa, contato (nome, tags, etapa, score), últimas 20 mensagens e etapas do pipeline. O banco revalida a §1; se a conversa saiu da IA, a tarefa é descartada; se faltar cota ou chave, a conversa vai para humano.
4. Pipeline (§4).
5. `complete_ai_reply(job_id, token, result)` grava o resultado numa transação:
   - **Simulador:** mensagem `outbound`, `sender_type='ai'`, `status='sent'`.
   - **Instagram:** mensagem `outbound` `sender_type='ai'` + intent de envio da Fase 5 (respeita janela de 24h, retries e deduplicação); em seguida acorda o worker do Instagram (`dispatch_instagram_worker`). Fora da janela de 24h → transferência com motivo "fora da janela de 24h".
   - evento `ai_replied` com `actor_type='ai'` (pendência da Fase 2), incremento de `ai_usage_daily`.
6. Falha da OpenAI ou do worker: até 3 tentativas com espera crescente (10 s, 30 s, 90 s); depois, transferência com motivo "falha temporária da IA". Reservas expiradas voltam para a fila por uma varredura.

## 3. Dados

Migrations novas (nunca editar as existentes):

- **`ai_jobs`**: `id`, `organization_id`, `kind` (`reply` | `index_document`), `conversation_id` ou `document_id` (FKs compostas com a organização), `document_generation`, `state` (`pending` | `running` | `done` | `failed` | `cancelled`), `attempts`, `run_after`, `claim_token`, `claimed_until`, `last_error` (código curto, sem conteúdo de mensagem), timestamps. Índice único parcial: uma `reply` pendente por conversa; uma `index_document` pendente por documento. Somente serviço escreve; sem leitura para `authenticated`.
- **`ai_usage_daily`**: `organization_id`, `day` (no fuso da organização), `replies`, `tests`. Membros leem a própria organização; serviço escreve.
- **Limites:** `private.ai_limits` com padrão (300 respostas, 30 testes) e exceções por organização; função `ai_quota(org)` para a tela.
- **`ai_classifications`**: FK composta garantindo que a mensagem pertence à conversa (pendência da Fase 1).
- **`messages`**: coluna `ai_metadata jsonb` (somente serviço escreve) com `used_chunk_ids` e verificação; usada para auditoria.
- **`conversations`**: coluna `handoff_reason text` (escrita pelo serviço; limpa ao devolver para IA).
- **`knowledge_documents`**: coluna `generation int` incrementada a cada edição/reprocessamento; `chunk_count` derivado.
- **`match_knowledge_chunks(p_org, p_embedding, p_k, p_min_similarity)`**: filtra por organização com `hnsw.iterative_scan` (pendência da Fase 1); execução só pelo serviço.

Funções no padrão do projeto: SECURITY DEFINER com `search_path=''`, nomes qualificados, revogadas de `public`/`anon`, grants por coluna, auditoria por trigger onde houver configuração.

## 4. Pipeline de resposta (`packages/core` + `ai-worker`)

Código puro em `packages/core` (testado sem OpenAI):
- `AIProvider` (`chat`, `structured`, `embed`); `OpenAIProvider` no lado Deno com `OPENAI_BASE_URL` configurável (para o proxy de teste) e modelos por env `AI_CHAT_MODEL`, `AI_EMBEDDING_MODEL` (padrão `text-embedding-3-small`, 1536). `FakeAIProvider` só em testes.
- `chunkText`: ~800 tokens, sobreposição de 100, respeitando parágrafos.
- `buildPrompt`: blocos delimitados — regras fixas (pt-BR, imutáveis) → agente → empresa → contato → `<knowledge>` → `<conversation>` (últimas 20). Conteúdo de `<knowledge>` e `<conversation>` é dado, nunca instrução.
- `verifyFacts`: valores monetários, percentuais, prazos (ex.: "3 dias", "48h", datas) e quantidades de estoque presentes na resposta precisam aparecer textualmente nos trechos citados ou nos dados da empresa.
- `detectInjection`: padrões em pt-BR e inglês ("ignore as instruções", "você agora é", "mostre seu prompt", blocos imitando `system:`).
- `decideHandoff`: aplica as regras e devolve o motivo.
- Schemas Zod: classificação `{intent, sentiment, lead_score 0..100, needs_human, summary, suggested_stage|null}` e resposta `{reply, used_chunk_ids, needs_human, handoff_reason}`.

Ordem na tarefa `reply`:
1. Injeção na última mensagem do cliente → transferência ("possível manipulação"), sem chamar a OpenAI.
2. Classificação → `ai_classifications`; atualiza `conversations.intent/sentiment/summary` e `contacts.lead_score`; garante deal aberto em "Novo" no pipeline padrão; `suggested_stage` só avança, nunca para Ganho/Perdido.
3. RAG: embedding das últimas mensagens do cliente → até 5 trechos acima do limiar.
4. Resposta estruturada; `used_chunk_ids` filtrados aos recuperados.
5. `verifyFacts`.
6. Decisão: envia, ou transfere.

**Transferência para humano** quando: `needs_human` (classificação ou resposta), nenhum trecho acima do limiar e a pergunta exige informação factual, verificação falhou, injeção, cota esgotada, chave ausente, falhas esgotadas ou fora da janela de 24h. Efeito: `status='pending_human'`, `handled_by='human'`, `handoff_reason`, nota de sistema no Inbox com o motivo, evento `handoff`; se o agente tem `human_handoff` ligado, envia ao cliente "Vou te encaminhar para um atendente, só um instante." (sujeito à janela do Instagram); se desligado, só marca e avisa a equipe.

## 5. Base de conhecimento

- Criar/editar/reprocessar: `status='processing'`, `generation+1`, apaga chunks antigos, cria tarefa `index_document` (tudo em uma função transacional chamada pelo app com RLS de admin).
- Worker: `chunkText` → `embed` em lote → `complete_index_document(doc, generation, chunks)` grava só se a geração ainda for a atual; senão descarta. Resultado `ready` ou `error` com mensagem segura.
- Sem chave: documento vai para `error` "IA não configurada na plataforma".
- Limites: conteúdo até 200.000 caracteres (já existente); upload `.txt`/`.md` até 1 MB, lido no navegador como texto UTF-8; o arquivo não é armazenado.

## 6. Área de teste

- Edge Function `ai-playground` chamada com o JWT do usuário; confirma membership e papel admin/owner no banco; consome a cota de testes.
- Executa o mesmo pipeline (injeção, classificação, RAG, resposta, verificação, decisão) sobre um histórico local de até 10 mensagens enviado pela tela; não grava conversas, classificações, deals nem eventos.
- Retorna resposta, classificação, trechos usados (título do documento, trecho, semelhança), resultado da verificação e decisão de transferência com motivo.

## 7. Telas

**`/ia`** (substitui o placeholder):
- Formulário: nome, personalidade, objetivo, tom, prompt adicional (≤ 8.000), chaves "Ativo", "Responder automaticamente", "Transferir para humano". React Hook Form + Zod; estados de carregamento, sucesso, erro e tentar novamente.
- Situação: "IA não configurada na plataforma" | "Base de conhecimento vazia" | "Pronto"; uso do dia ("42 de 300 respostas · 3 de 30 testes").
- Área de teste (§6).
- admin/owner editam e testam; agent/viewer só visualizam.

**`/conhecimento`** (substitui o placeholder):
- Lista com título, status (com mensagem de erro), número de trechos e data; atualização em tempo real.
- Criar/editar (título + conteúdo ou upload `.txt`/`.md`), "Reprocessar", "Excluir" com confirmação.
- Estados vazio e "IA não configurada". Escrita só admin/owner.

**Inbox:**
- Selo "IA" nas mensagens `sender_type='ai'`.
- Motivo da transferência visível na conversa.
- "Assumir" (humano passa a atender; a tarefa pendente é cancelada) e "Devolver para IA" (admin e agent; `handled_by='ai'`, `status='open'`, limpa `handoff_reason`; a IA volta a responder na próxima mensagem do cliente).
- Humano que envia mensagem numa conversa da IA também a assume.
- Painel do contato mostra a classificação mais recente (intenção, sentimento, resumo).

## 8. Segurança

- `OPENAI_API_KEY` só nas Edge Functions; nunca `NEXT_PUBLIC_*`, nunca em `apps/web`.
- `ai-worker` autenticado como o worker do Instagram, com segredo próprio em `private`.
- Logs e `last_error` nunca contêm texto de mensagens ou documentos.
- Conteúdo de clientes e documentos sempre delimitado no prompt; regras fixas prevalecem.
- Tabelas novas com RLS, sem políticas para `anon`, grants por coluna, `revoke truncate/references/trigger`.

## 9. Testes e definição de concluído

Nenhum teste chama a OpenAI real.
- **core (Vitest):** chunking, montagem do prompt, `verifyFacts` (muitos casos de R$, %, prazos, estoque), `detectInjection`, `decideHandoff`, schemas.
- **pgTAP:** criação/adiamento da tarefa por mensagem; elegibilidade por canal e agente; reserva, expiração e retry; cota diária; RLS e grants das tabelas novas; `match_knowledge_chunks` isolado por organização; indexação com geração; assumir/devolver; evento `ai_replied` com ator IA; handoff.
- **Edge (Deno):** `ai-worker` e `ai-playground` com provider falso — resposta enviada (Simulador e Instagram), cada motivo de transferência, retries, chave ausente, autenticação.
- **Playwright:** proxy local que imita a OpenAI via `OPENAI_BASE_URL`; cenários: documento → pronto; mensagem no Simulador → resposta com selo "IA"; pergunta sem base → transferência com motivo; área de teste; "Assumir" e "Devolver para IA".

Concluído quando: todas as suítes passam (`npm test`, typecheck, lint, pgTAP, edge, e2e), README e guia de configuração da IA atualizados (como definir `OPENAI_API_KEY` e limites), e `fase-6-pendencias.md` registra decisões e pendências.
