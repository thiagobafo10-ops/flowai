# Fase 4 — Decisões de execução e pendências

Branch: `feat/fase-4-inbox`. Registro de execução em 2026-10-12.

## Decisões

- A lista, a busca e os contadores do Inbox são consultas SQL com RLS. Os cursores usam horário e ID, preservando os microssegundos do Postgres. Isso evita linhas puladas e páginas curtas; o custo é manter mais lógica no banco.
- `last_message_at` só avança. Mensagens antigas não reposicionam a conversa. Datas futuras são limitadas ao presente, e o Simulador autenticado usa a hora do servidor.
- Erros do provedor aparecem em português; detalhes técnicos ficam nos logs do servidor. Assumir, fechar ou reabrir sem mudança de estado não duplica o histórico.
- Marcar como lida exige que a conversa pertença à organização ativa, mesmo quando o usuário participa de várias empresas. O custo é uma consulta adicional.
- Uma assinatura autenticada de Realtime é compartilhada pela navegação e pelo Inbox. A inicialização aguarda a sessão antes de assinar; a assinatura invalida lista, conversa, não lidas e contato. O layout consulta a contagem inicial.
- Editar o lead score altera apenas essa coluna, preservando mudanças simultâneas nos demais dados do contato. Atualizações remotas sincronizam o campo quando ele não está sendo editado.
- Mensagens já carregadas permanecem no histórico quando uma nova mensagem desloca a página mais recente. Tags invalidam o cache do contato após a fila de gravações terminar.
- Os testes aguardam até 15 segundos pelos redirects de cadastro/onboarding. As duas passagens completas de navegador usam `--repeat-each=2` no mesmo build; isso valida a repetição dos fluxos, sem recompilar fontes idênticas duas vezes.

## Pendências

- Após “Carregar mais” na lista de conversas, uma atualização em tempo real volta à primeira página de 50 itens. O usuário pode carregar novamente; a retenção das páginas da lista fica para uma melhoria posterior.
- A alteração de responsável/status e a mensagem de sistema ainda são duas operações. Uma RPC transacional por ação pode tornar o histórico atômico diante de falhas intermediárias.
- Antes da Fase 5, revisar a spec do MVP conforme o [roadmap](roadmap.md): comentários com palavra-chave, respostas e menções em stories, além de Direct e WhatsApp.
- Canais reais, IA, automações, mídia e anexos seguem nas fases seguintes.

## Pendências anteriores resolvidas

- O app não pode criar contatos com identidade/origem de canais reais.
- Mensagens recebidas atualizam `last_interaction_at`; `closed_at` das conversas é mantido por gatilho.
- A ficha lista conversas e informa que excluir o contato também remove conversas e mensagens.

## Verificação

- Testes unitários: 81 passando.
- Banco: reset completo e 589 testes pgTAP passando.
- TypeScript e lint passando.
- Revisão independente: nenhum achado importante ou bloqueante.
- Navegador: 64 testes executados duas vezes, 128 passando no build de produção.
- Inspeção visual: desktop e celular verificados; fonte Geist restaurada e componentes sem cortes ou sobreposições.
