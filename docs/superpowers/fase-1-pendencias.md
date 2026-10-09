# Fase 1 — Decisões tomadas e pendências para as próximas fases

Registro gerado ao final da execução da Fase 1 (branch `feat/fase-1-fundacao`). Cada decisão traz o custo se estiver errada.

## Decisões tomadas durante a execução

1. **`audit_logs` sem FKs** (`organization_id`, `actor_id` são uuid simples) — o histórico de auditoria sobrevive à exclusão de orgs/usuários e o append-only continua absoluto. *Custo:* linhas órfãs (intencional); apagamento LGPD de ids de ator precisará de um caminho documentado no nível do owner.
2. **`check_rate_limit` executável por `anon`** (necessário antes do login), com validação de entrada e limpeza global oportunista. *Custo:* alguém pode gastar a cota de um par conhecido `login:<ip>:<email>` por 15 min.
3. **Rate limit e audit em modo fail-open** no login/cadastro (erro de RPC é logado, não bloqueia). *Custo:* sem throttling durante uma falha do banco; precisa de alerta até a Fase 10.
4. **Um agente de IA por organização** (`unique (organization_id)` em `ai_agents`) — spec §14 deixa multiagente fora do MVP. *Custo:* remover a constraint quando houver multiagente.
5. **Grants por coluna** em quase todas as tabelas (ex.: `conversations` só atualiza status/handled_by/assigned_to/closed_at; `messages` só status/error; `organizations` só name/company_info/timezone; `channels` nunca expõe ids de segredo — `select *` em channels falha de propósito). *Custo:* fases futuras adicionam grants pontuais.
6. **Atualização de mensagem** restrita ao próprio autor e a mensagens outbound. *Custo:* Fase 4 amplia se precisar.
7. **Limites de tamanho**: título de documento ≤ 200, conteúdo ≤ 200.000, system prompt ≤ 8.000 caracteres.
8. **Eventos (`events`) só podem ser gravados por código definer do banco** — nenhum usuário insere eventos direto, porque eles alimentam as métricas do dashboard. *Custo:* Fase 2 cria funções/triggers que emitem eventos (já era necessário).
9. **Auditoria automática por trigger** em memberships, organizations, channels, ai_agents e automations (metadata guarda só os nomes das colunas alteradas, nunca valores). O app só pode registrar `auth.login` via `log_auth_event`. *Custo:* volume de auditoria maior.
10. **Tela de erro com "Tentar novamente"** usa `retry()` do Next 16.4 (o `reset()` não recarrega os dados do servidor).
11. **Testes e2e acessam o banco LOCAL** (via `docker exec`) para limpar rate limits e conferir contagens — nunca código do app.
12. **Commits trazem o co-autor do modelo que os escreveu** (alguns dizem Sonnet 5.5, outros Opus 5.5).

## Pendências por fase

**Antes da Fase 2**
- Convenção escrita: toda página e Server Action de `(app)` chama `getActiveOrg()` por conta própria (o guard do layout não é barreira de segurança).
- `resolveActiveOrg` sem critério de desempate para `created_at` igual (necessário quando houver troca de organização).
- Acessibilidade dos formulários: `aria-describedby`, anúncio duplicado (alerta + toast), flash vazio do `fallback={null}`.
- `log_auth_event` sem rate limit (inchaço de auditoria).

**Fase 3 (CRM)**
- Mover deal entre pipelines exige RPC (`pipeline_id`/`contact_id` imutáveis); trocar pipeline padrão exige RPC (ordem unset → set).
- Índices de apoio: `deals(organization_id, pipeline_id)`, `events(contact_id)`, `events(deal_id)`.
- CSP `img-src` para o Storage quando houver avatares.

**Fase 4 (Inbox)**
- Eventos DELETE do Realtime não são filtrados por RLS (vazam só ids).
- Manter `last_message_at` / `closed_at` consistentes.

**Fase 5 (Meta)**
- `channels.status` deve ser controlado só pelo service role (admin hoje consegue marcar `active`).
- Excluir canal apaga todo o histórico de conversas → trocar por restrict/desativação.
- Agente consegue marcar a própria mensagem como `delivered`/`read` → restringir a `failed → pending`.
- Índice para a limpeza de `rate_limits` (volume de webhook por IP).
- Se surgir rota `/api` de webhook no Next, liberar no matcher do proxy.

**Fase 6 (IA/RAG)**
- Chunks sempre inseridos com embedding; editar documento deve resetar status e chunks.
- `match_knowledge_chunks` com `hnsw.iterative_scan` ou `ef_search` maior por causa do filtro de org.
- FK composta garantindo que a mensagem classificada pertence à conversa.

**Fases 7/8 (Automações)**
- INSERT em `automations` não é restrito por coluna (admin pode gravar `created_by_ai`, `status='active'`) → forçar `draft` + validador na ativação.
- `automation_run_steps` não amarra o node à automação do run; arestas duplicadas permitidas; cascatas apagam histórico de execuções.

**Fase 10 / antes do deploy**
- `x-forwarded-for` é falsificável → usar o IP fornecido pela plataforma de hospedagem.
- Alerta para o fail-open do rate limit; limites reais vêm do Supabase Auth (rate limit + captcha).
- Rate limit na criação de organizações dentro da RPC.
- Trigger `before truncate` em `audit_logs` (postgres/service_role ainda podem truncar).
- Checagem global de RLS: cobrir policies `TO public`, sequences e funções.
- Projeto Supabase remoto com "Confirm email" ligado: o caminho "Verifique seu e-mail" não tem teste automatizado.
- Corrida de duplo envio concorrente na criação de org.
- Caminho do Docker do Windows fixo no helper de e2e (ajustar quando houver CI).

**Fora das fases atuais (sinalizar ao produto)**
- Convites e gestão de membros: hoje não há proteção de "último owner" e um admin pode adicionar qualquer perfil sem consentimento. Nenhuma fase do plano cobre convites.

**Cosmético / quando conveniente**
- Slug com hífen inicial para nomes só com símbolos (`-a1b2c3`) ou `--` no corte de 40 caracteres.
- Tipos gerados sem formatação; pequenos ajustes de formatação em testes.
