# Fase 3 — Decisões tomadas e pendências para as próximas fases

Registro gerado ao final da execução da Fase 3 (branch `feat/fase-3-crm`). Complementa `fase-1-pendencias.md` e `fase-2-pendencias.md`. Cada decisão traz o custo se estiver errada.

## Decisões tomadas durante a execução

1. **Valores em R$ no formato brasileiro**: "1.500" vale 1500 e "1.234,56" vale 1234,56 (um "1.234" no estilo americano viraria 1234). Limite de R$ 999.999.999.999,99.
2. **Excluir etapa só move deals para uma etapa aberta** — evita fechar deals (e inflar ganhos/perdidos) como efeito colateral. *Custo:* para mover para Ganho, o admin move os deals antes.
3. **Etapas só mudam por funções do banco** (criar, reordenar, excluir movendo deals, trocar Ganho/Perdido), com checagem de Admin; pelo app só dá para renomear direto. **Pipeline também travado**: não dá para criar, excluir ou trocar o pipeline padrão pela API (um pipeline por organização).
4. **Salvar contato não sobrescreve o que outra pessoa mudou**: tags e campos só são enviados quando são o que está sendo editado.
5. **Kanban e dashboard sempre com dados atuais** ao navegar pela sidebar (antes podiam ficar até 30 s desatualizados).
6. **"Marcar como Ganho/Perdido" pede confirmação** dizendo quantos deals serão fechados ou reabertos.
7. **Origem e identidade do canal do contato** (`source`, `whatsapp_id`, `instagram_id`, `last_interaction_at`) não podem ser **alteradas** pelo app — serão escritas pelo backend dos canais.
8. **Kanban acessível**: teclado (espaço/setas pulando uma coluna), avisos para leitor de tela em português, menu "Mover para…" como alternativa.
9. **Testes no navegador rodam contra o build de produção** (porta 3100), esperando a página hidratar e os salvamentos terminarem — resolveu a instabilidade.
10. **Mensagens de erro específicas** para etapa removida, responsável removido e deal excluído por outra pessoa.

## Pendências por fase

**Início da Fase 5 (prioridade alta — antes de existir canal real)**
- A **criação** de contato pela API ainda aceita `source`, `whatsapp_id`, `instagram_id` e `last_interaction_at` (só a edição foi bloqueada). Revogar o insert dessas colunas para `authenticated` antes de receber mensagens de WhatsApp/Instagram, senão alguém poderia criar um contato com o ID de WhatsApp de outra pessoa.
- Busca de contatos e do kanban: hoje varre todos os contatos da organização e filtra o kanban em JavaScript sem limite de linhas; criar índices (`pg_trgm`/unaccent) e limitar antes do volume de canais.
- Telefones com zero ou prefixo de operadora ("011 …") são recusados.

**Fase 4 (Inbox)**
- Texto da exclusão de contato precisa mencionar conversas e mensagens (que também serão apagadas).
- "Última interação" depende do Inbox preencher `last_interaction_at`.
- Ficha do contato: bloco "Conversas" ainda vazio.

**Antes da Fase 9 (Analytics)**
- Criar `closed_at` nos deals: hoje a data de "ganho/perdido" e o filtro de 30 dias usam `updated_at`, que muda ao editar título/valor.
- Decidir se existe evento "deal reaberto" (arrastar para fora de Ganho é fácil agora).

**Fase 10 / qualidade**
- Mensagem de conflito ao trocar Ganho/Perdido pode citar o contato errado em um caso raro (falta excluir a etapa-alvo da busca).
- Mapeamento de erro de chave estrangeira depende dos nomes automáticos das constraints.
- Dica "O pipeline precisa de ao menos uma etapa aberta." só aparece com o menu aberto; alça de arrastar das etapas com 28 px.
- Reordenar etapas arrastando com o mouse não tem teste automatizado (teclado e Subir/Descer têm).
- Botão "Novo contato" duplicado no estado vazio; filtros sem indicador de carregamento.

**Cosmético / quando conveniente**
- Ajustes de formatação em alguns componentes; `export *` expõe helpers internos de filtros.
