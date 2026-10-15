# Instagram public VIP implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Responder publicamente aos novos comentários e entregar o convite VIP solicitado por comentário, sem IA.

**Architecture:** Um fluxo VIP por canal, independente das automações privadas existentes, captura eventos novos e reserva operações pública e privada separadamente. O worker existente processa a fila autenticada; configuração administrativa fica na tela Instagram.

**Tech Stack:** PostgreSQL/Supabase/pgmq, TypeScript, Deno, Next.js/React.

**Spec:** docs/superpowers/specs/2026-10-14-instagram-public-vip-design.md — aprovada pelo usuário em 2026-10-14.

## Global Constraints

- Texto público exato e link WhatsApp definidos na spec; sem IA, sem disparos reais nos testes.
- Todas as publicações; somente comentários posteriores à ativação, sem histórico.
- Organização, canal e autoria verificados; bloquear duplicações, ecos e repetição após resultado incerto.
- Não alterar ou consumir a seleção das automações atuais. Não resetar banco nem expor segredos.
- Configuração inicialmente desativada, com prévia e ativação explícita pela interface.

## Review Focus

- Evento duplicado e recuperação após reserva não podem provocar novo POST.
- Comentário próprio com ID app-scoped diferente deve ser ignorado pela identidade oficial.
- Desativação ou desconexão entre preparação e reserva deve impedir envio.
- Falha de uma operação não pode repetir a outra já enviada nem consumir automações privadas existentes.
- Configuração por outro tenant ou agente sem papel administrativo deve ser rejeitada.

### Task 1: Fluxo persistente e transporte

**Files:** Nova migration `supabase/migrations/20261016000004_instagram_public_vip.sql`; novo pgTAP `supabase/tests/database/052_instagram_public_vip.test.sql`; provider Instagram e testes; novo handler VIP e testes Edge; adaptação do worker/index; tipos gerados.

**Interfaces:** A UI usa tabela `instagram_vip_settings` com `channel_id`, `organization_id`, `enabled`, `public_reply_text`, `group_url`, `activated_at`, `last_error`; RPC autenticada `save_instagram_vip_settings(p_channel_id uuid,p_enabled boolean,p_public_reply_text text,p_group_url text)` retorna jsonb. Configuração padrão ausente significa desativada. RPC verifica admin/owner, canal Instagram ativo/conexão e permissão de comentários antes de ativar. Builder define fila e RPCs internas com tipos explícitos no handler. Operações privada e pública possuem reserva independente e idempotência. Consultar documentação primária Meta antes de fixar endpoint/permissão.

- [x] Escrever e executar testes que falham para configuração, isolamento, ativação temporal, duplicação, reserva concorrente, pausa, desconexão, prazo privado e resultado incerto.
- [x] Implementar migration adicional e testes; aplicar somente em banco local se disponível, sem reset.
- [x] Escrever e observar falha de testes de transporte público/privado e worker com fetch simulado: propriedade, autoria própria, VIP palavra inteira, permissão, 429, timeout, falhas independentes.
- [x] Implementar provedor e worker com APIs oficiais, sem envio real. Falhas incertas nunca repetidas; respeitar sete dias para resposta privada. Tornar erro de permissão visível e impedir ativação sem verificação.
- [x] Executar pgTAP, testes core/Edge e tipos relevantes, revisar diff. Esperado: todos passam. Registrar comandos e limitações concretas.

Evidência Task 1: 2.217 pgTAP/52 arquivos e 215 Edge passaram após as correções de revisão. Reservas foram testadas em duas sessões concorrentes, incluindo desconexão. Revisão independente aprovada. O endpoint de resposta pública foi confirmado no SDK oficial; o endpoint de consulta de permissões ainda requer confirmação na conta real. Testes simulados não comprovam suporte real da Meta.

### Task 2: Configuração e prévia administrativa

**Files:** `apps/web/src/lib/instagram/{queries,actions}.ts`; componente novo VIP nas configurações Instagram; schemas/testes de formulário; tipos do banco e documentação de operação.

**Interfaces:** Consome tabela e RPC da Task 1. Uma configuração por canal; ações server validam papel e entrada, banco faz autorização definitiva. Grupo tem URL HTTPS `chat.whatsapp.com` com código não vazio. Salvar desativado não dispara nada. UI permite salvar/ativar/pausar, mostra ambos os textos e alcance temporal, erros sem segredos.

- [ ] Ler documentação Next instalada, escrever teste que falha para validação de URL/texto/estado e prévia do fluxo.
- [ ] Implementar configuração por canal na tela Instagram com link recebido preenchido e texto exato; manter funções existentes.
- [ ] Executar testes web, tipos, lint e build quando memória permitir; verificar UI com navegador sem envio real. Esperado: configurações e validação funcionam, sem ativação implícita.
- [ ] Documentar ativação, requisito de permissão e resultados incertos; revisão independente da implementação inteira e correção das falhas importantes.

## Execução

Executar nesta conversa, sem novo pedido de aprovação do escopo. Revisores independentes após tarefas e ao final conforme Superpowers. Branch local dedicada; nenhuma publicação/ativação real automática.
