# Configurar o Instagram no FlowAI

## Requisitos da conta

Use uma conta profissional (empresa ou criador) e a API com Instagram Login. A configuração inicial é manual. Nesta etapa, cada conta conectada usa um app Meta próprio; o mesmo app não é compartilhado entre organizações.

No painel Meta, configure Instagram Login e obtenha o ID da conta profissional, o ID do app, o App Secret usado para assinar webhooks e o Access Token da conta. Escolha explicitamente a versão da Graph API utilizada pelo app. As permissões necessárias são `instagram_business_basic`, `instagram_business_manage_messages` e `instagram_business_manage_comments`.

Use um **token de longa duração** (60 dias) na conexão: troque o token de curta duração por um longo antes de salvar (`GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=<APP_SECRET>&access_token=<TOKEN_CURTO>`). O FlowAI renova o token automaticamente perto do vencimento; veja [Operação do backend](#operação-do-backend).

Confira os requisitos de acesso e revisão no painel Meta. A documentação de webhooks exige conta pública e Advanced Access para notificações de comentários; o comportamento com contas de teste também depende dos papéis e das permissões concedidas ao app. Consulte [configuração oficial de webhooks](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup).

## Conectar na interface

1. Como proprietário ou administrador, abra **Configurações → Canais → Instagram**.
2. Informe nome, IDs, versão e credenciais. Salve. Os valores de App Secret e Access Token são apagados do formulário e não podem ser consultados na interface.
3. Use **Testar conexão Instagram**. O FlowAI verifica se o token representa a conta informada e solicita as subscrições da conta.
4. Configure no app Meta a URL de webhook mostrada pelo FlowAI. Use **Mostrar verify token** para obter o valor de confirmação; depois oculte-o.
5. Assine `messages`, `comments`, `messaging_seen` e `messaging_postbacks`. A URL deve ser pública e HTTPS para receber eventos da Meta; localhost só atende os testes locais. `messaging_postbacks` é o que permite retomar uma automação quando o contato toca num botão; `messaging_seen` traz os recibos de leitura.
6. Após verificar token e callback, o canal fica ativo. A confirmação GET sozinha não ativa o canal.

Para trocar credenciais, use **Atualizar credenciais**, mantendo os IDs. A alteração invalida as verificações anteriores. Para outra conta, cadastre uma conexão com outro app. **Desconectar Instagram** bloqueia novos eventos/envios e preserva o histórico. Depois de desconectar, **Remover conexão** apaga as credenciais do Vault; sem histórico, a conexão e o canal somem, com histórico ficam desconectados até novas credenciais.

Uma conta ou app só pertence a uma organização depois que o teste do token passa. Cadastros não verificados expiram em 24 horas e cedem lugar à organização que verificar primeiro; se a conta já estiver verificada em outra organização, o FlowAI mostra "Esta conta do Instagram já está conectada a outra organização."

## Atender e criar regras

Mensagens do Direct entram no Inbox e criam/atualizam o contato no CRM. Respostas e menções em stories mostram sua origem. A equipe pode responder com texto de até 1.000 bytes UTF-8 dentro da janela comum de 24 horas após uma mensagem recebida elegível. Fora dela, a conversa mostra que a janela expirou e só aceita notas internas. Comentários não abrem essa janela. Se o contato ainda não tem nome, o worker busca o nome do perfil do Instagram (sem bloquear nada se falhar). Excluir o contato no CRM apaga os dados brutos guardados dos eventos dele. Conteúdo sem texto aparece como indicação de mídia; anexos não são baixados.

Em **Comentários → Direct**, escreva uma palavra ou frase completa e a resposta. Escolha todos os posts/Reels ou um ID específico; o FlowAI confere a propriedade do post antes de salvar. A regra começa desativada. Quando ativada, comentários novos correspondentes recebem uma resposta privada, respeitando a janela de até sete dias e uma resposta por comentário. Se várias regras corresponderem, a mais antiga já ativa quando o comentário foi feito tem prioridade. Letras maiúsculas, acentos e espaços repetidos não alteram a correspondência.

Editar ou desativar uma regra descarta seu trabalho anterior pendente. Uma regra pode ser desligada mesmo com token inválido. Acompanhamentos exigem que o destinatário responda e abra a janela normal de mensagens.

Um envio de resultado incerto fica sem confirmação e não é repetido automaticamente. Confira o Instagram antes de tentar uma nova mensagem. Falhas explícitas de respostas humanas têm uma tentativa controlada no próprio histórico.

## Links rastreáveis e resultados

Botões de link enviados pelas automações (e pelo follow-up) apontam para `https://<app>/r/<código>`, com 12 caracteres. O clique é registrado e a rota redireciona (302) para a URL de destino guardada no banco — nunca para um valor vindo da requisição. Código malformado, desconhecido ou URL que não seja `https` mostram a página **Link inválido** (404). O registro é limitado a 30 cliques por minuto por link; acima disso o redirecionamento continua, mas o clique não é contado.

A lista de automações mostra **Execuções (7 dias)**, **Cliques (7 dias)** e **Contatos (7 dias)**. Os mesmos números, com cliques por botão (caminho e link), aparecem em `ver_resultados` no Claude. O período dessa ferramenta é de até 90 dias.

## Operação do backend

As migrations e Edge Functions `meta-connection`, `meta-webhook`, `send-message`, `instagram-worker` e `meta-token-refresh` precisam estar instaladas no mesmo projeto Supabase. O webhook é público e exige HMAC; as outras funções usam verificação JWT, além das verificações de papel ou segredo interno. A chave privilegiada só existe no backend Edge/Vault.

Para habilitar o agendamento, o operador configura `public.configure_instagram_worker(base_url, service_role_jwt, worker_secret)` pelo backend privilegiado. Use um segredo aleatório com pelo menos 32 caracteres e uma URL base do Supabase acessível pelo banco. O helper guarda os dois segredos no Vault. O `service_role_jwt` é a chave legada JWT do projeto, compatível com a verificação de JWT do gateway; não use uma publishable key ou uma `sb_secret_...` nesse parâmetro.

No ambiente local, a URL usada pelo banco é `http://supabase_kong_flowai:8000`; em hospedagem, use a URL HTTPS do projeto. `flowai-instagram-worker` executa a cada minuto e `flowai-instagram-cleanup` diariamente. A configuração global fica no schema privado. Sem provisionamento, o cron não faz chamadas externas.

O job `flowai-meta-token-refresh` roda diariamente (06:00 UTC) e renova o token de longa duração dos canais Instagram ativos que expiram em menos de 15 dias — desde que o token tenha mais de 24 h, como a Meta exige. A Edge Function `meta-token-refresh` usa o mesmo segredo interno dos workers e grava o token novo no mesmo segredo do Vault, sem mudar `credential_generation`: o token antigo continua válido e reservas/envios em andamento não são invalidados. Falhas (`token_refresh_failed`/`invalid_token`) aparecem em **Configurações → Saúde**; os logs nunca registram o token. Ordem de deploy e diagnóstico: [mcp-setup.md](mcp-setup.md#23-migrations-e-edge-functions).

Eventos operacionais concluídos são limpos após 30 dias, preservando itens pendentes e histórico. A fila tem até cinco tentativas com espera crescente para falhas anteriores à aceitação. Um envio incerto não entra nesse retry. Cada execução do worker esvazia a fila em lotes de 3 itens simultâneos por até ~100 s; sem itens visíveis o cron nem chama a função. O mesmo cron, a cada minuto, marca como sem confirmação respostas do Direct presas em envio por mais de 1 minuto e como falha (com nova tentativa permitida) as que nunca saíram após 10 minutos.

`channels.app_secret_secret_id`, `channels.verify_token_secret_id` e `channels.waba_id` são colunas reservadas da Fase 2 e não são usadas pelo Instagram (os segredos ficam em `meta_connections`).

## Verificar sem conta real

Além de Node/Docker, instale Deno 2 ou informe seu caminho em `DENO_BIN`.

```bash
npm run db:reset
npm run db:test
npm test
npm run test:edge
npm run test:instagram:e2e
```

O último comando inicia um proxy local exclusivo de testes: Auth, REST, RLS e Realtime continuam reais; somente o transporte da Graph API é injetado. Ele executa a suíte completa de navegador na porta 3101, pausa e restaura o cron local e termina o proxy ao sair. Nenhuma opção de simulação é instalada nos handlers de produção. Para executar apenas Instagram, acrescente `-- instagram.spec.ts`.

Os testes usam o Supabase local; o runner recusa outro host. Pare um proxy manual na porta 54326 antes de executar o runner. Um build com a URL do proxy serve apenas aos testes: para iniciar o app fora deles, execute o build normal com `apps/web/.env.local`.

## Validação ao vivo pendente

Esta entrega ainda precisa de um app Meta real, conta profissional e permissões aprovadas para validar callback público, Direct, comentários e stories ao vivo. Os contratos consultados e as limitações verificadas estão em [instagram-contracts.md](instagram-contracts.md). A confirmação remota de leitura está pendente porque a documentação de sender actions mistura hosts/exemplos de APIs; a leitura local e os receipts recebidos continuam funcionando.
