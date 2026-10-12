# Fase 5 — Instagram: execução e limites

Branch `codex/fase-5-instagram`; base `aacfe07`. Escopo aprovado em 2026-10-12: somente Instagram; WhatsApp adiado.

## Estado

Implementação concluída nas tarefas 1–8; verificação final e revisão independente em andamento. Configuração manual, Direct, contextos de stories, regras de comentário, worker e Vault estão implementados. [Guia de configuração](instagram-setup.md).

## Limites

- Validação ao vivo depende de app Meta e conta profissional; nenhum envio real foi realizado nesta execução.
- Confirmação remota de leitura pendente por inconsistência da documentação oficial; não há endpoint presumido. Leitura local e `messaging_seen` recebidos funcionam.
- Cada conexão manual usa uma conta/app próprio. OAuth, app compartilhado, WhatsApp, mídia enviada, anexos, IA e automações genéricas permanecem fora desta etapa.
- Texto: 1.000 bytes UTF-8; janela comum de 24h; private reply único em até sete dias. Restrições e permissões da Meta prevalecem.

## Decisões de execução

- Execução na checkout existente em nova branch, seguindo a escolha de implementação nesta sessão. Não há segunda checkout isolada.
- Bookkeeping em PowerShell no Windows, mantendo brief, base, ledger e logs equivalentes aos scripts Bash. O custo é reprodução manual dessas operações.
- Nenhuma chamada remota de `mark_seen` presumida; custo: confirmação remota de leitura temporariamente indisponível.
- Verificações remotas levam a geração das credenciais ao SQL, impedindo reativação por resultado antigo; handlers precisam informar essa geração.
- Status do simulador conserva seus callers; um trigger impede mudanças diretas de estado do Instagram. Novos providers deverão ter controle equivalente.
- Completion exige claim token; tentativas antigas não completam uma tentativa nova. Todos os handlers carregam o token.
- Desconexão e retry receberam migrations próprias antes do worker; sua migration passou de 003 para 004 e depois 005. O custo é divergência dos nomes originais do plano, preservando a ordem e a imutabilidade.
- O compositor mantém request ID estável e limpa rascunhos já representados no histórico, inclusive falha/resultado incerto. Retry explícito usa a mensagem existente; o texto rejeitado permanece no histórico.
- O worker consulta a criação real do comentário e a propriedade da mídia, não a hora de entrega do webhook. Custo: consultas adicionais antes de enviar.
- Configuração global do worker fica em schema privado, mantendo o requisito de organization_id nas tabelas públicas; os helpers de serviço preservam sua interface.
- Captura de regras usa o estado no recebimento, porque webhooks podem ter precisão de segundos; a elegibilidade temporal real é conferida no worker. Desativar post inalterado não depende de token/prova novos; ativação e troca continuam verificadas.

## Evidências parciais

- Unitários: 123 passando; Edge: 37 passando; TypeScript e lint passando.
- SQL: 653 passando antes do último caso de desativação; caso focado de mídia 6/6 após a correção. Reset/suíte completos finais pendentes.
- Instagram no navegador: cinco cenários passando, incluindo resposta privada única e token expirado.
- Callback HTTP local: challenge 200, payload assinado 200, duplicado 200 e uma mensagem gravada.
- pg_net: worker autenticado respondeu 200 com fila vazia; cron por minuto e limpeza diária verificados.
- Desktop/celular inspecionados, sem cortes ou sobreposições. Screenshots preservadas no diretório de visualizações desta conversa.
