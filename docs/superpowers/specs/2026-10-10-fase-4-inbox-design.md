# FlowAI — Fase 4: Inbox + Conversas + Mensagens — Design

- **Data:** 2026-10-10
- **Status:** aguardando revisão
- **Base:** spec do MVP (`2026-10-07-flowai-mvp-design.md` §4, §9, §10), specs das Fases 2–3, pendências (`docs/superpowers/fase-*-pendencias.md`)
- **Branch:** `feat/fase-4-inbox` (a partir de `master`)

---

## 1. Objetivo e entendimento

Transformar o módulo **Inbox** (hoje "Em construção") num atendimento funcional em três colunas, com tempo real, e criar a **porta única de entrada de mensagens** que a Fase 5 (WhatsApp/Instagram) vai reutilizar. Como ainda não existe app da Meta, um **canal Simulador** — claramente identificado como teste — permite receber e responder mensagens de ponta a ponta.

### Decisões do brainstorming
| Tema | Decisão |
|---|---|
| Sem canal real | Canal "Simulador" criado pelo Admin; simula mensagens recebidas pelo mesmo caminho do webhook; respostas marcadas como entregues |
| Conversa fechada recebe mensagem | Reabre a mesma conversa, como "Aberta" e sem responsável |
| Visibilidade | Todos os membros veem todas as conversas da org; abas Minhas / Não atribuídas / Aguardando humano / Todas / Fechadas |
| Atribuição | "Assumir" (vira responsável, atendimento humano); "Transferir/Atribuir" (escolhe membro, nota opcional); mensagem de sistema registra cada ação |
| "Devolver para IA" | Só aparece com agente de IA ativo (Fase 6) |
| Arquitetura | Supabase Realtime (`postgres_changes`, RLS) + React Query; entrada pela função `ingest_inbound_message`; saída por Server Action + `ChannelProvider` |

### Critérios de aceitação do MVP cobertos (com o Simulador)
7 (recebe mensagem), 8 (aparece no Inbox), 9 (contato criado), 17 (humano assume), 18 (conversa encerrada); 19 (dashboard registra) continua valendo pelos eventos da Fase 2.

---

## 2. Canal Simulador e fluxo de mensagens

### 2.1 Interface de canal (`@flowai/core`)
```ts
interface ChannelProvider {
  receiveMessage(raw: unknown): InboundMessage[];
  sendMessage(to: ChannelRecipient, content: OutboundContent): Promise<{ externalId: string }>;
  markAsRead(externalMessageId: string): Promise<void>;
  getContact(externalUserId: string): Promise<ChannelContactProfile>;
}
```
- `InboundMessage = { externalId: string; senderExternalId: string; senderName: string | null; text: string; sentAt: string }`.
- `SimulatorProvider`: `receiveMessage` converte `{ name, phone, text }` (validado) em `InboundMessage` com `externalId = "sim_" + uuid` e `senderExternalId` = telefone normalizado; `sendMessage` devolve `{ externalId: "sim_" + uuid }`; `markAsRead` não faz nada; `getContact` devolve `{ name: null }`.
- Fábrica `providerFor(channelType)`: `simulator` → `SimulatorProvider`; `whatsapp`/`instagram` → erro "Canal ainda não disponível." (Fase 5).

### 2.2 Banco
- `channel_type` ganha `simulator`; `contact_source` ganha `simulator` (rótulo "Simulador"). No máximo um canal `simulator` por organização (índice único parcial). Canal simulador nasce `status='active'`.
- `conversations` ganha `last_read_at timestamptz` (nullable); agentes podem atualizar.
- `public.ingest_inbound_message(p_channel uuid, p_external_id text, p_sender_external_id text, p_sender_name text, p_text text, p_sent_at timestamptz) returns uuid` (id da mensagem; mesma id se duplicada) — `SECURITY DEFINER`, `search_path=''`, transacional:
  1. Lê o canal (org, tipo, status). Canal inexistente ou inativo → erro `P0002`.
  2. **Autorização:** permitido para `service_role`; para `authenticated` apenas se o canal for `simulator` e `has_role(org,'admin')`; senão `42501`.
  3. Texto 1–4096 caracteres (`22023`).
  4. Contato: para `simulator`/`whatsapp` busca pelo telefone normalizado (`contacts.phone`, e `whatsapp_id` na Fase 5); para `instagram` por `instagram_id`; cria se não existir (`source` = tipo do canal, `name` = `p_sender_name`).
  5. Conversa do contato naquele canal (a mais recente): se `closed` → reabre (`status='open'`, `assigned_to=null`, `closed_at=null`, `handled_by` conforme regra abaixo); se não existir → cria. `handled_by='ai'` somente se o agente da org estiver `is_active and auto_reply`; senão `'human'`.
  6. Mensagem `inbound`, `sender_type='contact'`, `status='delivered'`, `external_id=p_external_id`; conflito em `(channel_id, external_id)` → retorna a mensagem existente sem efeitos.
  7. Atualiza `conversations.last_message_at` e `contacts.last_interaction_at` com `p_sent_at`.
- `public.log_conversation_system_message(p_conversation uuid, p_kind text, p_target_user uuid default null) returns void` — `SECURITY DEFINER`, exige `has_role(org,'agent')`; `p_kind ∈ {'assumed','assigned','unassigned','closed','reopened'}`; grava mensagem `sender_type='system'`, `direction='outbound'`, `status='delivered'`, texto montado no banco (nomes de `profiles.full_name`): "{ator} assumiu a conversa", "{ator} transferiu para {alvo}", "{ator} removeu o responsável", "Conversa fechada por {ator}", "Conversa reaberta por {ator}".
- Gatilho em `conversations`: ao mudar `status` para `closed` define `closed_at = now()`; ao sair de `closed` limpa `closed_at`.
- Mensagens de sistema e notas internas **não** alteram `last_message_at` (a lista ordena por conversa com mensagem real); respostas humanas e inbound alteram.

### 2.3 Simular mensagem
- **Configurações → Canais** (`/configuracoes/canais`, aba nova; admin+): bloco "Simulador" com "Criar canal Simulador" (se não existir), status e formulário **Nome**, **Telefone** (obrigatório, BR), **Mensagem** (1–4096) + botão "Simular mensagem recebida"; "Desativar" (`status='needs_setup'`) e "Reativar" (`status='active'`); canal desativado recusa novas mensagens simuladas. Bloco "WhatsApp e Instagram" com "Disponível em breve".
- Inbox: botão "Simular mensagem" (admin+, só se houver simulador ativo) abre o mesmo formulário em diálogo.
- Server Action `simulateInbound(input)` → `SimulatorProvider.receiveMessage` → RPC `ingest_inbound_message` com o cliente do usuário.

### 2.4 Envio
Server Action `sendReply(conversationId, text)` (agent+): insere mensagem `outbound`/`human`/`pending` (RLS da Fase 1) → `providerFor(channel.type).sendMessage` → atualiza `status` (`delivered` no simulador; `sent` nos reais) e `external_id`, ou `failed` + `error`. Conversa fechada → recusa com "Reabra a conversa para responder.". `retryMessage(messageId)` reenvia mensagens `failed` do próprio usuário. `addInternalNote(conversationId, text)` insere `is_internal_note=true`, `status='delivered'`, sem provedor.

---

## 3. Tela do Inbox (`/inbox`)

### 3.1 Layout
- ≥ 1280px: três colunas — lista (~320px), conversa (flexível), contato (~320px, recolhível com "Ocultar contato"/"Mostrar contato").
- 768–1279px: lista + conversa; contato abre como painel lateral pelo botão "Contato".
- < 768px: uma coluna por vez (lista → conversa → contato) com "Voltar".
- URL: `/inbox?aba=<minhas|nao-atribuidas|aguardando|todas|fechadas>&c=<conversationId>&q=<busca>&canal=<channelId>`; aba padrão **`todas`** (fixa, para previsibilidade); valores inválidos voltam ao padrão.

### 3.2 Coluna 1 — lista
- Abas com contador (conversas que satisfazem o filtro; Fechadas sem contador): **Minhas** (`assigned_to = eu` e não fechadas), **Não atribuídas** (`assigned_to is null` e `status='open'`), **Aguardando humano** (`status='pending_human'`), **Todas** (não fechadas), **Fechadas** (`status='closed'`).
- Busca `q`: nome, telefone (dígitos) ou texto da última mensagem; filtro de canal visível com mais de um canal.
- Item: avatar com iniciais, `contactDisplayName`, trecho da última mensagem não-interna (prefixo "Você: " se humana), horário relativo (`agora`, `N min`, `HH:mm` hoje, `ontem`, `dd/MM`), selo do canal ("Simulador"/"WhatsApp"/"Instagram"), iniciais do responsável, ponto de não lida.
- **Não lida**: a mensagem não-interna mais recente é `inbound` e `created_at > coalesce(last_read_at, '-infinity')`.
- Ordem `last_message_at desc`; 50 por página com "Carregar mais".
- Vazios: sem nenhuma conversa → "Nenhuma conversa ainda" + "Conecte um canal em Configurações → Canais" (ou "Simule uma mensagem" com simulador ativo); aba vazia → "Nada por aqui".

### 3.3 Coluna 2 — conversa
- Cabeçalho: nome do contato, selo do canal, status ("Aberta"/"Aguardando humano"/"Fechada"), responsável; ações **Assumir** (quando não é o responsável), **Transferir**, **Fechar** / **Reabrir**.
- Histórico: 50 mais recentes + "Ver anteriores"; balões inbound à esquerda; humanas/IA/automação à direita com autor ("Você", nome do agente, "IA", "Automação") e hora; notas internas em amarelo com selo "Nota interna"; sistema centralizada em cinza; status de envio no balão ("Enviando…", "Enviada", "Entregue", "Lida", "Falhou" + "Tentar novamente"); separadores de data ("Hoje", "Ontem", `dd/MM/yyyy`).
- Rolagem: abre no fim; ao chegar mensagem com o usuário no fim, rola; senão mostra "Novas mensagens ↓".
- Composer: alternância **Responder** / **Nota interna**; Enter envia, Shift+Enter quebra linha; contador a partir de 3.900 caracteres; limite 4096; desabilitado com "Reabra a conversa para responder." em conversa fechada; oculto para viewer.
- Abrir a conversa chama `markRead` (atualiza `last_read_at`).

### 3.4 Coluna 3 — contato
- Nome, telefone (formatado), e-mail, status, "Ver ficha" (`/contatos/[id]`).
- Tags (reusa `TagPicker` com a mesma serialização da ficha).
- Pipeline: deal aberto (etapa + valor) com "Mover etapa" (lista de etapas) ou "Criar deal" (abre `DealDialog` com o contato).
- IA: lead score (editável, agent+), intenção, sentimento e resumo da conversa — vazios mostram "Aguardando IA".

### 3.5 Tempo real
- Um canal Realtime por usuário com `postgres_changes` em `messages` e `conversations` filtrados por `organization_id=eq.<org>` (RLS aplicada). Eventos atualizam o cache do React Query (lista, contadores, conversa aberta).
- Desconexão → selo "Reconectando…" no topo da lista; ao reconectar, invalida as queries do Inbox.
- Sidebar: item **Inbox** com contador de não lidas (Minhas + Não atribuídas), atualizado em tempo real.

---

## 4. Ações e permissões

| Ação | Quem | Efeito |
|---|---|---|
| `sendReply`, `retryMessage`, `addInternalNote` | agent+ | §2.4 |
| `takeOver(conversationId)` | agent+ | `assigned_to=eu`, `handled_by='human'`; se `pending_human` → `open`; mensagem de sistema `assumed` |
| `assignConversation(conversationId, userId \| null, note?)` | agent+ | troca responsável (membro da org); nota opcional vira nota interna; sistema `assigned`/`unassigned` |
| `closeConversation` / `reopenConversation` | agent+ | status + sistema `closed`/`reopened` |
| `markRead(conversationId)` | qualquer membro | `last_read_at = now()` (via função `SECURITY DEFINER` para incluir viewers) |
| `createSimulatorChannel`, `setSimulatorActive`, `simulateInbound` | admin+ | §2.3 |

- Todas as Server Actions: `getActiveOrg()`, papel, Zod, escopo por organização, `.select("id")` para detectar 0 linhas; mensagens: "Você não tem permissão para esta ação.", "Não foi possível concluir. Tente novamente.", "Esta conversa não existe mais.".
- Banco: grants de `conversations` UPDATE passam a ser `(status, handled_by, assigned_to, last_read_at)` — `closed_at` vira responsabilidade do gatilho. O app continua só inserindo mensagens humanas próprias (Fase 1); contato/sistema/IA só por funções definer.
- `markRead` para viewer: `public.mark_conversation_read(p_conversation uuid)` definer com `is_member`.

## 5. Integrações e pendências fechadas
- Ficha do contato: bloco "Conversas" lista conversas (canal, status, última mensagem, horário) com link `/inbox?c=<id>`.
- Exclusão de contato: texto passa a "Excluir contato? Esta ação não pode ser desfeita. As tags, os campos, os deals, as conversas e as mensagens deste contato também serão excluídos."
- `last_interaction_at` mantido pela entrada (pendência Fase 1/3); `closed_at` coerente (pendência Fase 2).
- Pendência da Fase 3 (prioridade antes de canais reais): revogar `insert (source, whatsapp_id, instagram_id, last_interaction_at)` em `contacts` para `authenticated` — feito nesta fase, já que a entrada passa a criar contatos por função definer.
- Dashboard: sem mudanças (eventos da Fase 2).

## 6. Testes
- **Vitest**: `SimulatorProvider`; schemas do simulador e da resposta; `isUnread`; `formatRelativeTime` pt-BR; `inboxTabFilter`/parse da URL.
- **pgTAP**: `ingest_inbound_message` (cria contato+conversa; dedup por external_id; reabre fechada sem responsável; atualiza last_message_at e last_interaction_at; `handled_by` conforme agente; admin simulador ok; agent → 42501; canal real como authenticated → 42501; outra org → 42501; texto vazio → 22023); `log_conversation_system_message` (lista fixa, agent+, texto com nomes); gatilho `closed_at`; `mark_conversation_read` (viewer ok, outra org 42501); grants novos (agent não altera `closed_at`; insert de `source` em contacts → 42501); um simulador por org.
- **Playwright** (harness da Fase 3: build de produção, `gotoReady`, `aria-busy`): admin cria simulador e simula mensagem → aparece no Inbox de outro usuário **sem recarregar**; contato criado em Contatos; agente assume, responde (balão "Entregue"), transfere com nota (mensagem de sistema), fecha e reabre; mensagem nova reabre conversa fechada sem responsável; nota interna amarela e fora do trecho da lista; viewer só lê; celular navega lista → conversa → contato; ficha do contato lista a conversa; dashboard conta a mensagem.

## 7. Fora do escopo
WhatsApp/Instagram reais (Fase 5); IA respondendo e "Devolver para IA" (Fase 6); automações (Fase 7); mídia e anexos; respostas rápidas; indicador "digitando"; busca dentro das mensagens antigas.
