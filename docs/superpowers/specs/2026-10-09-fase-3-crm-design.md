# FlowAI — Fase 3: Contatos + Tags + Pipeline + Deals — Design

- **Data:** 2026-10-09
- **Status:** aguardando revisão
- **Base:** spec do MVP (`2026-10-07-flowai-mvp-design.md`), spec da Fase 2 (`2026-10-09-fase-2-layout-dashboard-design.md`), pendências (`docs/superpowers/fase-1-pendencias.md`, `fase-2-pendencias.md`)
- **Branch:** `feat/fase-3-crm` (a partir de `master`)

---

## 1. Objetivo e entendimento

Transformar os módulos **Contatos** e **Pipeline** (hoje "Em construção") em telas funcionais, mais o gerenciamento de **Tags** e das **etapas do pipeline** em Configurações.

### Decisões do brainstorming
| Tema | Decisão |
|---|---|
| Contatos | Criar, editar e excluir manualmente; sem importação de CSV |
| Pipeline | Um pipeline por organização; Admin edita etapas (renomear, reordenar, adicionar, remover, escolher Ganho/Perdido) |
| Deals | Criados pelo kanban ou pela ficha; 1 deal aberto por contato; arrastar entre colunas + menu "Mover para…"; Ganho/Perdido filtrados por 30 dias por padrão |
| Campos personalizados | Lista livre "nome → valor" por contato |
| Lead score | Editável manualmente por agentes (a IA passará a atualizar na Fase 6) |
| Arquitetura | Leitura no servidor; gravação por Server Actions; React Query só no kanban (otimista); operações de várias linhas em funções SQL transacionais (`SECURITY INVOKER`) |

### Premissas
- Canais chegam na Fase 5: até lá, contatos existem só por cadastro manual. Conversas no histórico do contato chegam na Fase 4 (estado vazio explícito até lá).
- Moeda: todos os deals são BRL (o formulário não oferece moeda), o que fecha a pendência de moeda da Fase 2.
- Com um pipeline por organização, as pendências "mover deal entre pipelines" e "trocar pipeline padrão" deixam de se aplicar.

### Critério de aceitação da fase
- Critério 14 do MVP ("contato aparece no CRM") passa a ser visível: contato criado → aparece em Contatos; deal criado → aparece no Pipeline; movimentações refletem no Dashboard.
- Todas as ações respeitam a matriz de permissões (§5) e funcionam no celular.

---

## 2. Contatos

### 2.1 Lista `/contatos`
- Desktop: tabela com colunas **Nome** (avatar de iniciais), **Telefone**, **E-mail**, **Status**, **Lead score**, **Tags**, **Responsável**, **Última interação**, **Origem**. Celular (< 768px): cartões com nome, status, tags e responsável.
- Busca `q` (nome, telefone ou e-mail; sem acento e sem diferenciar maiúsculas); filtros `status` (`lead|customer|inactive`), `tag` (id), `responsavel` (user id ou `nenhum`), `origem` (`whatsapp|instagram|manual`); ordenação `ordem` (`interacao` padrão = `last_interaction_at desc nulls last, created_at desc`; `nome`; `criado`; `score`); paginação `pagina` (25 por página). Tudo na URL; valores inválidos voltam ao padrão.
- Rótulos pt-BR: status `lead` → "Lead", `customer` → "Cliente", `inactive` → "Inativo"; origem `whatsapp` → "WhatsApp", `instagram` → "Instagram", `manual` → "Manual". Última interação vazia → "—".
- Estados: vazio sem filtros → "Nenhum contato ainda" + botão "Novo contato"; vazio com filtros → "Nenhum contato encontrado" + "Limpar filtros"; carregando → esqueleto; erro → "Não foi possível carregar os contatos." + "Tentar novamente".

### 2.2 Diálogo "Novo contato" / "Editar contato"
- Campos: **Nome**, **Telefone**, **E-mail**, **Status** (padrão Lead), **Responsável** (membros da org; padrão: sem responsável), **Tags** (multi-seleção com criação na hora), **Lead score** (0–100, padrão 0).
- Validação: ao menos um de nome, telefone ou e-mail; nome ≤ 120; e-mail válido; telefone brasileiro normalizado para E.164 (`+55DDDNÚMERO`, aceita entrada com máscara, com ou sem `+55`, 10 ou 11 dígitos nacionais); lead score inteiro 0–100.
- Origem `manual` definida automaticamente na criação; não editável.
- Duplicidade: se outro contato da org tiver o mesmo telefone ou e-mail, mostrar aviso não bloqueante "Já existe um contato com este telefone/e-mail" com link para ele.

### 2.3 Ficha `/contatos/[id]`
- Cabeçalho: avatar, nome (ou telefone/e-mail se sem nome), status, lead score, responsável; ações "Editar" (agente+) e "Excluir" (admin+, com confirmação "Excluir contato? Esta ação não pode ser desfeita." — a exclusão remove tags, campos e deals do contato).
- Cards:
  - **Dados**: telefone, e-mail, origem, criado em, última interação.
  - **Tags**: chips com remover (agente+) e "Adicionar tag".
  - **Campos personalizados**: lista nome → valor; adicionar, editar, remover (agente+). Nome ≤ 60, valor ≤ 500, nomes únicos por contato.
  - **Deal**: deal aberto (etapa, valor, responsável, link "Ver no pipeline") ou botão "Criar deal" (agente+); abaixo, deals encerrados (ganho/perdido) com data.
  - **Histórico**: linha do tempo dos eventos do contato (`contact_created`, `deal_created`, `deal_stage_changed` com nomes das etapas, `deal_won`, `deal_lost`), mais recente primeiro, com data/hora no fuso da org. Bloco "Conversas" com "Nenhuma conversa ainda." (Fase 4).
- Contato inexistente ou de outra org → página 404 do app ("Contato não encontrado").

### 2.4 Função `save_contact`
`public.save_contact(p_org uuid, p_contact_id uuid, p_data jsonb, p_tag_ids uuid[], p_custom_fields jsonb) returns uuid` — `SECURITY INVOKER` (RLS vale), transacional: cria (se `p_contact_id` nulo, com `source='manual'`) ou atualiza o contato, substitui o conjunto de tags e o conjunto de campos personalizados. Tags e responsável precisam ser da mesma org (FKs compostas garantem). Retorna o id.

---

## 3. Tags

- **Configurações → Tags** (`/configuracoes/tags`): lista com nome, cor e quantidade de contatos; criar (agente+), renomear e trocar cor (admin+), excluir (admin+, confirmação; remove a tag de todos os contatos).
- Paleta fixa de 8 cores: `slate`, `red`, `amber`, `green`, `teal`, `blue`, `indigo`, `pink` (armazenadas como esse nome em `tags.color`; padrão `slate`).
- Nome: 1–40 caracteres, único por org sem diferenciar maiúsculas (índice já existe). Erro: "Já existe uma tag com este nome."
- `/configuracoes` deixa de ser placeholder: página com abas **Tags** e **Pipeline** (admin) e um bloco "Em construção" para Organização, Equipe e Integrações.

---

## 4. Pipeline e deals

### 4.1 Kanban `/pipeline`
- Colunas = etapas do pipeline padrão em ordem; cabeçalho: nome, quantidade e soma dos valores (BRL).
- Card: nome do contato, título, valor, lead score, iniciais do responsável; clique abre o diálogo do deal.
- Mover: arrastar (dnd-kit; mouse, toque e teclado) com atualização otimista e rollback + toast em erro; menu "Mover para…" no card (alternativa móvel/acessível).
- Filtros (URL): `q` (contato ou título), `responsavel`, `encerrados` (`30d` padrão | `todos`) — limita deals ganhos/perdidos atualizados nos últimos 30 dias.
- Visualizador: sem arrastar, sem botões de criação/edição (cards abrem em modo leitura).
- Estados: esqueleto; erro com "Tentar novamente"; colunas vazias com "Novo deal".

### 4.2 Diálogo do deal
- Campos: **Contato** (busca; contatos com deal aberto aparecem desabilitados com "já tem deal aberto"), **Título** (padrão "Oportunidade — {nome do contato}", ≤ 120), **Valor** (R$, ≥ 0, até 2 casas), **Responsável**, **Etapa**.
- Criado a partir de uma coluna: etapa pré-selecionada; a partir da ficha: contato pré-selecionado.
- Excluir: admin+, confirmação.
- Conflito do índice de deal aberto → "Este contato já tem um deal aberto."

### 4.3 Configurações → Pipeline (`/configuracoes/pipeline`, admin+)
- Lista de etapas: renomear (1–40), reordenar (arrastar e botões "Subir"/"Descer"), "Adicionar etapa" (entra antes da primeira etapa encerrada), marcar "Ganho"/"Perdido".
- Invariantes garantidos no banco: exatamente uma etapa `is_won`, exatamente uma `is_lost`, ao menos uma etapa aberta, nomes únicos por pipeline.
- Funções `SECURITY INVOKER` (RLS de admin vale), transacionais:
  - `public.reorder_stages(p_pipeline uuid, p_stage_ids uuid[]) returns void` — `p_stage_ids` deve conter exatamente as etapas do pipeline; posições 0..n-1.
  - `public.delete_stage_moving_deals(p_stage uuid, p_target_stage uuid) returns void` — proibido para etapa de Ganho/Perdido; move deals para o destino (mesmo pipeline) e exclui; renumera posições.
  - `public.set_stage_outcome(p_stage uuid, p_outcome text) returns void` — `p_outcome ∈ {'won','lost'}`; transfere a marca da etapa atual para `p_stage` (que deixa de ter a marca oposta, se tinha); o gatilho da Fase 2 recalcula o status dos deals; conflito de deal aberto → erro 23505 traduzido para "Não foi possível: o contato {nome} ficaria com dois deals abertos."
- Exclusão de etapa com deals exige escolher o destino na própria tela.

---

## 5. Permissões, auditoria e erros

| Ação | Visualizador | Agente | Admin/Owner |
|---|---|---|---|
| Ver contatos, pipeline, tags | ✔ | ✔ | ✔ |
| Criar/editar contato, campos, deal; mover deal; criar tag e aplicar | | ✔ | ✔ |
| Excluir contato/deal/tag; renomear/recolorir tag; editar etapas | | | ✔ |

- Server Actions: Zod + `getActiveOrg()` + checagem de papel; RLS como segunda barreira. Toda página usa `RequireOrg`.
- Auditoria (gatilho `audit_row_change` existente): `pipelines` e `pipeline_stages` em insert/update/delete; `contacts`, `deals` e `tags` só em delete.
- Mensagens: validação inline; "Você não tem permissão para esta ação."; "Não foi possível concluir. Tente novamente."; mensagens específicas das §2–4.

## 6. Banco (resumo)
- Migration nova `20261010000001_crm_functions.sql`: `save_contact`, `reorder_stages`, `delete_stage_moving_deals`, `set_stage_outcome`, invariantes de etapas (gatilho que valida exatamente um Ganho/um Perdido/ao menos uma aberta ao fim da transação — constraint trigger deferrable), unicidade de nome de etapa por pipeline (`lower(name)`), unicidade de nome de campo personalizado por contato (já existe), gatilhos de auditoria, índices `events(contact_id)`, `events(deal_id)`, `deals(organization_id, pipeline_id)`.
- Nenhuma migration existente é editada.

## 7. Testes
- **Vitest (`@flowai/core`)**: schemas de contato, deal, tag e etapa; `normalizeBrazilianPhone`; parse de filtros/ordem/página da lista de contatos e do kanban; soma de colunas.
- **pgTAP**: `save_contact` (cria, atualiza, substitui tags/campos atomicamente; tag/responsável de outra org → erro; viewer → 42501); `reorder_stages`, `delete_stage_moving_deals`, `set_stage_outcome` (invariantes, conflito 23505 sem estado parcial, agente → bloqueado pela RLS); invariantes impedem remover a última etapa aberta ou ficar sem Ganho/Perdido; auditoria nas tabelas novas; isolamento entre orgs.
- **Playwright**: criar contato com tags e campo; buscar/filtrar/paginar; editar; excluir (admin); visualizador sem botões; criar deal pela ficha; mover deal arrastando e por "Mover para…" e ver o dashboard refletir; erro de deal duplicado; gerenciar tags; editar etapas (renomear, reordenar, adicionar, excluir movendo deals, trocar etapa de Ganho).

## 8. Fora do escopo
Importação de CSV; campos personalizados definidos pela organização; vários pipelines; convites/gestão de membros; conversas no histórico (Fase 4); edição em massa.
