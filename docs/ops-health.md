# Painel de Saúde/Ops

Tela **Configurações → Saúde** (somente `admin`/`owner`): mostra, em uma página só, o que
está faltando, preso ou falhando na operação — sem precisar abrir o banco.

## O que a tela mostra

- **Avisos no topo** — lista o que exige atenção, em ordem de gravidade (crítico em vermelho).
- **Canais** — status do canal, quando o token e o webhook da conexão Meta foram validados,
  se a conexão está desconectada e o último erro (`last_error`).
- **Eventos do Instagram** — fila do worker: na fila, incerto, falhou, ignorados/recebidos em 24h,
  o evento mais antigo aguardando e os erros mais comuns (últimos 7 dias).
- **Envios** — Direct e respostas privadas de comentário: na fila, enviando, falhou, incerto,
  enviados em 24h e erros mais comuns.
- **Automações** — execuções executando/aguardando/pendentes, falhas em 24h e execuções travadas.
- **Inteligência artificial** — tarefas na fila, executando, falhas em 24h e tarefas travadas.
- **Respostas automáticas (VIP)** — ativado/desativado por canal, quando os comentários foram
  verificados e erros relatados.

## Como funciona

- A leitura é feita pela função `public.ops_health(uuid)` (SECURITY DEFINER), criada na migration
  `20261017000002_ops_health.sql`. As filas internas (`instagram_events`, `ai_jobs`) não são
  legíveis por `authenticated`, então a agregação é feita no banco.
- A função exige **administrador da própria organização** (`has_role(...,'admin')`) e filtra tudo
  por `organization_id`; nenhum segredo é exposto (só metadados de verificação da conexão).
- O retorno é validado com Zod (`opsHealthSchema` em `packages/core`) antes de renderizar.
- O botão **Atualizar** reexecuta a consulta no servidor (`router.refresh()`).

## Limites

- Não substitui alertas automáticos: é uma verificação sob demanda, na tela.
- Os limites de "travado" são heurísticos (eventos pendentes > 5 min, execuções paradas > 15 min,
  tarefas de IA com lease expirado) e podem ser ajustados conforme o volume real.
- O painel não envia mensagens nem reprocessa filas; a recuperação continua sendo feita pelos
  workers e pelas funções de reenvio existentes.
