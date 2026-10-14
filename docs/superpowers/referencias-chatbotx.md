# Referências do ChatbotX para o FlowAI

Análise autorizada em 2026-10-14. Fonte: [ChatbotXIO/ChatbotX](https://github.com/ChatbotXIO/ChatbotX), snapshot `dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6`. Esta é uma análise de arquivos selecionados, não uma auditoria integral nem uma validação com a Meta.

## Decisão de aproveitamento

Manter Next.js, Supabase, domínio compartilhado e workers Deno do FlowAI. Usar os arquivos abaixo como referências de interação e casos de teste. Não importar os pacotes internos do ChatbotX: dependem de seu SDK, banco Drizzle, autorização, traduções e infraestrutura própria. A spec aprovada do FlowAI continua sendo a autoridade.

Nenhum código do ChatbotX foi incorporado à aplicação nesta etapa. Caso um trecho seja adaptado posteriormente, registrar origem, revisão e avisos de licença no arquivo ou em THIRD_PARTY_NOTICES; conferir também as dependências e a licença do trecho específico. A [licença da revisão analisada](https://github.com/ChatbotXIO/ChatbotX/blob/dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6/LICENSE) distingue MIT de conteúdo empresarial e de componentes de terceiros.

## Task 9 — Links e QR

Arquivos inspecionados:

- [create-reflink.tsx](https://github.com/ChatbotXIO/ChatbotX/blob/dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6/apps/builder/src/features/reflinks/create-reflink.tsx): diálogo de criação, seleção de fluxo, validação e estado de envio.
- [magic-link-qr-dialog.tsx](https://github.com/ChatbotXIO/ChatbotX/blob/dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6/apps/builder/src/features/magic-links/magic-link-qr-dialog.tsx) e [qr-code-link-content.tsx](https://github.com/ChatbotXIO/ChatbotX/blob/dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6/apps/builder/src/features/qr-codes/qr-code-link-content.tsx): prévia de QR e cópia com tratamento de falha.

Aplicação no FlowAI: formulário com nome, canal, código e tag; prévia do link e QR; feedback de sucesso/falha ao copiar; ações PNG/SVG. Reutilizar `instagramEntryLink` do core e a biblioteca `qrcode` prevista no plano. O exemplo usa `react-qr-code` e não fornece os downloads exigidos pelo FlowAI: não acrescentar essa dependência nem tratar a prévia como exportação pronta. A associação com automação continua pelo gatilho `entry_link`; não copiar o modelo de reflink ligado diretamente a flowId/customFieldId.

Verificar: ausência de usuário Instagram, erro de clipboard, geração e download PNG/SVG, código ocupado, arquivamento e permissão de viewer.

## Task 10 — Sequências

Arquivos inspecionados: [sequence-editor.tsx](https://github.com/ChatbotXIO/ChatbotX/blob/dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6/apps/builder/src/features/sequences/sequence-editor.tsx) e [delay-selector.tsx](https://github.com/ChatbotXIO/ChatbotX/blob/dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6/apps/builder/src/features/sequences/components/delay-selector.tsx).

Aplicação no FlowAI: passos em cartões ordenados, estado vazio com ação para primeiro passo, espera com número/unidade e campo local editável antes de confirmar a alteração. Implementar com os componentes locais e o formulário de mensagem compartilhado. O exemplo seleciona fluxos por passo e admite opções de espera fora da nossa spec; manter mensagem própria, mínimo de 1 minuto, máximo de 30 dias, janela no fuso da organização e proteção de alterações não salvas. Ordenar uma cópia do array, sem reproduzir a ordenação mutável de props do exemplo.

Verificar: conversão min/h/dias, valor temporariamente vazio sem salvar zero, adicionar/remover/reordenar, validação antes de ativar e retomada do mesmo passo após pausa. As correções SQL de pausa e sweep permanecem pendentes da revisão da Task 7; esta referência não as resolve.

## Task 11 — Campanhas

Arquivos inspecionados: trechos de [create-broadcast-form.tsx](https://github.com/ChatbotXIO/ChatbotX/blob/dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6/apps/builder/src/features/broadcasts/create-broadcast-form.tsx) e [broadcast-confirm-dialog.tsx](https://github.com/ChatbotXIO/ChatbotX/blob/dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6/apps/builder/src/features/broadcasts/components/broadcast-confirm-dialog.tsx).

Aplicação no FlowAI: prévia assíncrona do público, indicação de carregamento, confirmação que acompanha a validade atual do formulário e bloqueio de envio duplicado. Manter o assistente aprovado em três etapas: público, mensagem, envio. Não incorporar recorrência, planos comerciais, múltiplos tipos de template ou canais adiados.

Ponto importante: não permitir confirmar um número antigo de destinatários depois de mudar os filtros. Associar a prévia à consulta atual e ignorar respostas atrasadas. Horários devem ser convertidos pelo fuso da organização; o exemplo usa o fuso do operador, que não satisfaz o contrato do FlowAI.

Verificar: mudança de filtros durante prévia, resposta fora de ordem, erro de consulta, formulário invalidado com confirmação aberta, duplo clique e conversão de horário. Contagens e destinatários vêm dos RPCs do FlowAI; não transplantar actions/banco externos.

## Instagram — candidato a teste de compatibilidade

Inspecionados: [incoming-message.ts](https://github.com/ChatbotXIO/ChatbotX/blob/dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6/integrations/instagram/src/handlers/message/incoming-message.ts) e [canonical-quick-replies.ts](https://github.com/ChatbotXIO/ChatbotX/blob/dd2f1d85ffe021b1edb12e623a5ec6fbcd9630f6/integrations/instagram/src/handlers/message/outgoing-message/canonical-quick-replies.ts).

O código externo considera referral no evento, no postback e na mensagem. O parser atual do FlowAI trata referral isolado e junto de mensagem; o caminho de postback não propaga referral. Registrar como lacuna candidata, não como formato Meta confirmado. Antes de alterar produção, criar fixtures para as três posições e combinações, definir precedência sem duplicar usos/execuções e preservar validação de assinatura, destinatário, contato e payloads `fa1`/`fd1`. Confirmar o formato com documentação oficial e teste real da Meta quando houver acesso.

Não copiar a recepção externa diretamente: ela possui dependências do SDK, anexos e um contrato de lote diferente. O FlowAI deve continuar processando o lote completo e descartando payloads falsificados. Respostas rápidas mantêm os payloads assinados gerados pelo nosso banco, nunca payloads arbitrários do exemplo.

## Ordem de execução

1. Finalizar e revisar as duas correções em andamento da Task 7.
2. Implementar Task 8 conforme os contratos atuais da fila.
3. Usar este mapa ao executar Tasks 9–11, com os testes acima nas respectivas etapas.
4. Na Task 12, verificar QR exportado, consistência da prévia e cenários de referral candidatos; registrar o que ainda depende de validação real.

O ganho esperado é reduzir pesquisa e decisões de interface. Não há estimativa de prazo medida; migração de backend e adoção integral do ChatbotX não fazem parte desta decisão.
