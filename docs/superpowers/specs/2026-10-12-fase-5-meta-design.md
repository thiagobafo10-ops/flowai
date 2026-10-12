# Fase 5 — Instagram primeiro

- Data: 2026-10-12.
- Status: aprovado pelo usuário em 2026-10-12, com foco exclusivo no Instagram; builder check concluído sem lacunas importantes.
- Base: Fase 4 concluída em `c935b4b`, roadmap de 2026-10-10 e design geral do MVP.
- Decisão do usuário em 2026-10-12: começar somente com Instagram; WhatsApp fica para uma etapa posterior, sem data definida.
- Premissa existente: ainda sem app Meta; validar contratos e payloads assinados localmente, com validação ao vivo quando houver app e contas de teste.

## Resultado esperado

A empresa conecta sua conta profissional do Instagram e recebe mensagens reais no mesmo Inbox já implementado. A equipe responde pelo Inbox, acompanha os estados disponíveis e identifica mensagens originadas de stories. Pode ativar uma regra simples que responde no Direct a comentários de posts/Reels contendo uma palavra-chave.

O objetivo decidido no roadmap é alcançar paridade com o ManyChat, preservando CRM, atendimento em equipe e isolamento entre empresas. Esta fase entrega os canais e uma automação específica de comentários; o editor genérico de automações continua na Fase 7.

## Escopo e escolhas propostas

1. Instagram API com Instagram Login: contas profissionais, entrada/saída de Direct e reconhecimento de respostas e menções em stories.
2. Comentários: cadastrar palavra-chave, selecionar um post/Reel ou todos os posts da conta, escrever a resposta privada e ativar/desativar. Uma resposta inicial por comentário, sujeita às regras oficiais da Meta. Não enviar uma resposta pública adicional.
3. Configuração manual na página existente de canais, com teste de credenciais e instruções de webhook. OAuth fica para uma fase posterior.
4. Conteúdo recebido sem texto aparece como indicação do tipo de mídia e contexto quando disponível. Esta fase não baixa anexos nem envia mídia.
5. WhatsApp, IA, campanhas em massa e editor de fluxos ficam fora desta fase. As filas e eventos deixam o caminho preparado para as Fases 6 e 7; WhatsApp será planejado separadamente.

O foco exclusivo no Instagram foi decidido pelo usuário. As escolhas de API, configuração manual e apresentação de mídia são propostas do implementador, não decisões já aprovadas pelo usuário. A opção Instagram Login permite contas profissionais sem exigir vínculo com uma Página do Facebook, conforme a coleção oficial da Meta. Não haverá suporte simultâneo ao antigo Facebook Login nesta fase.

## Conexão e isolamento

Para o piloto, cada organização configura um app Meta próprio. Uma conexão de app guarda app ID, app secret, verify token e versão da Graph API; os canais associados guardam o ID da conta profissional do Instagram e seu access token. Não criar campos, validações ou fluxos de conexão do WhatsApp nesta implementação.

Escolha do implementador: app ID único na instalação e vínculo imutável a uma organização. O produto mostra erro explicativo se outro cadastro tentar usar o mesmo app. Um app compartilhado entre empresas com onboarding OAuth fica fora desta fase. Isso evita prometer múltiplas URLs de callback para um único app.

Cada conexão recebe uma URL pública `/functions/v1/meta-webhook/{connection_id}`. A conexão determina o segredo de assinatura; cada item do payload determina o canal. O canal precisa pertencer à mesma conexão e organização. Não é permitido escolher uma empresa a partir de campos fornecidos sem confrontar esses vínculos.

Somente administradores criam, atualizam, testam ou desconectam credenciais. Agentes continuam atendendo os canais ativos. Tokens e segredos entram por HTTPS em uma Edge Function autenticada, são gravados no Vault e nunca retornam em listagens, logs, HTML ou eventos Realtime. A página informa apenas que estão configurados; alterações exigem fornecer o novo valor. O verify token pode ser revelado explicitamente ao administrador para configurar o webhook, com resposta sem cache.

Nenhuma chave privilegiada do Supabase entra em `apps/web`. A Edge Function valida o JWT do usuário e a associação/role consultando o banco antes de realizar operações privilegiadas. Helpers SQL para ler/gravar segredos têm execução exclusiva pelo serviço, `search_path` fixo e nenhum acesso genérico ao Vault por usuários autenticados. Escritas administrativas auditam IDs e resultado, nunca valores secretos.

Salvar credenciais deixa o canal em configuração. O teste verifica identidade e permissões remotamente; a confirmação do webhook é registrada separadamente. O canal só fica ativo quando os dois requisitos forem satisfeitos. Falha de token coloca a conexão em erro com mensagem segura; desconectar bloqueia novas entradas e envios e preserva histórico. Workers revalidam o estado antes de enviar.

## Contratos externos

Os providers permanecem em `packages/core`, com `fetch` e relógio injetados e apenas Web APIs, para execução em Node e Deno. O simulador continua funcionando. O parser passa a produzir eventos tipados: mensagem, comentário, estado de entrega e evento ignorado. O contrato de envio distingue mensagem normal e resposta privada a comentário.

Instagram usa ID da conta profissional e ID do usuário no escopo apropriado. A escolha do destinatário é específica do canal, corrigindo a prioridade atual que poderia selecionar telefone para um contato do Instagram. O provider do WhatsApp não será implementado nesta etapa; o tipo já existente no modelo de dados permanece reservado.

A versão da Graph API é configuração obrigatória da conexão e é validada sintaticamente. Não assumir uma versão "mais recente" fixa a partir da data. Os exemplos e fixtures identificam sua versão e fonte.

Antes de implementar cada adapter, conferir nos contratos oficiais: payload de comentários/stories, endpoint de resposta privada para Instagram Login, janela permitida, limite de texto e permissão/subscrição correspondente. Não reutilizar automaticamente endpoints de Facebook Login. Documentar a matriz de capacidades verificada e fixtures representativas. Se a documentação não puder ser consultada, essa capacidade continua explicitamente pendente de verificação, sem simulação apresentada como integração real.

## Entrada de webhook

GET confere `hub.mode`, compara verify token e devolve o challenge como texto. POST não exige JWT de usuário: a identidade vem da assinatura HMAC-SHA256 do corpo bruto, usando o app secret da conexão. Comparação sem saída antecipada dependente do conteúdo. Conferir tamanho e formato do header antes de processar JSON; aplicar limites de corpo, tempo e taxa, sem expor tokens em erros.

Depois da assinatura válida, normalizar todo o lote, verificar os IDs dos canais e persistir cada evento duravelmente. Um lote pode conter itens novos, duplicados e desconhecidos. Duplicados têm sucesso; tipos desconhecidos são contabilizados como ignorados; falha de persistência retorna erro para a Meta tentar novamente. Partes já persistidas continuam idempotentes. Conta sem vínculo é ignorada sem criar canal automaticamente.

Uma transação por evento registra uma chave única de deduplicação, ingere mensagem/contato/conversa quando aplicável e enfileira trabalho subsequente. Retornar 200 somente depois de terminar a persistência do lote aceito. Não chamar Graph API no caminho de recebimento.

Mensagens usam ID externo como chave. Comentários usam conexão/canal/tipo/comment ID. Estados de entrega usam ID da mensagem, estado e timestamp/event key, aceitando eventos repetidos e fora de ordem. IDs sensíveis de usuários continuam restritos à organização; o log operacional contém somente IDs internos, tipo e códigos seguros. Eventos desconhecidos não geram mensagens artificiais.

Respostas e menções de stories que forem eventos de mensagem criam uma entrada no Inbox com contexto disponível. Comentários ficam no registro de eventos e na regra; um comentário sozinho não abre a janela normal de mensagens nem cria uma falsa mensagem inbound. Se a resposta privada tiver sucesso, o contato e o envio aparecem no histórico com origem comentário. Se o comentarista responder, o Direct recebido segue a ingestão normal.

## Saída e entrega

A ação do Inbox valida organização, papel e conversa, cria a intenção de envio com identificador idempotente e invoca `send-message` com JWT do usuário. A Edge Function verifica novamente o usuário e o destinatário do registro; não aceita token, destinatário arbitrário ou mensagem de outra empresa enviados pelo cliente.

Uma transação reivindica a intenção antes de chamar a Meta, para que duas invocações não enviem o mesmo item. Após sucesso, o serviço grava external ID e estado. O simulador mantém seu caminho atual. O envio respeita a janela oficial do canal, usando último inbound elegível; comentário não renova essa janela. Quando exigir modelo ou outra autorização fora do escopo, o Inbox explica o bloqueio antes do envio. Não usar HUMAN_AGENT para contornar restrições de automação.

Timeout após possível aceitação pela Meta vira resultado incerto, visível ao atendente, sem reenvio automático. Erro explícito antes da aceitação pode ser tentado novamente de forma controlada com nova tentativa vinculada à intenção. O detalhe de armazenamento dessa tentativa fica ao implementador; um lease vencido nunca autoriza repetir cegamente um envio externo.

Estados avançam de pending para sent/delivered/read; evento atrasado não rebaixa read. Falha terminal não apaga uma entrega/leitura comprovada. Eventos recebidos antes da gravação do external ID ficam persistidos para reconciliação. Instagram só mostra os estados que seu contrato efetivamente fornecer, sem inventar paridade com WhatsApp.

Marcar conversa como lida atualiza primeiro o estado local; confirmação remota é trabalho independente e sua falha não desfaz a leitura local. Não enviar recebimento de leitura para notas ou eventos de comentário.

## Regra de comentário e worker

Administradores gerenciam regras; inicialmente todas desativadas. Para ativar, precisam de canal ativo e permissões verificadas. Seleção de post usa ID de mídia validado como pertencente à conta; escopo "todos" corresponde aos comentários recebidos da conta, sem varredura retroativa.

A palavra-chave é comparada como palavra/frase completa, sem diferenciar maiúsculas e acentos, com espaços normalizados. Texto vazio não corresponde. Se várias regras corresponderem, executar somente a mais antiga ativa (ordem estável por criação e ID). A interface explica essa precedência. Uma edição afeta apenas novos eventos; ativar não dispara respostas para comentários antigos.

O worker reivindica eventos da fila, valida canal/regra/janela atuais e cria uma intenção única por comentário. Só responde a comentários de terceiros; comentários da própria conta e itens sem identidade suficiente são ignorados com motivo. A resposta é privada e única; continuação depende da interação do usuário e das regras normais de mensagens.

A ingestão registra a versão da regra elegível naquele momento. Não escolher uma regra recém-ativada para um evento antigo na fila. Se a regra foi editada ou desativada antes do processamento, ignorar a intenção anterior com motivo; não substituir seu texto silenciosamente. Eventos de canais inativos são ignorados após autenticação da assinatura, sem criar mensagens nem trabalho de envio.

Usar pgmq para processamento durável com tentativas limitadas, backoff e registro de falha final. O mecanismo de chamada programada deve ser autenticado com segredo de serviço restrito no Vault; seu endpoint não pode ficar aberto. Worker não usa JWT de usuário: atua somente sobre intenções internas criadas por regras verificadas. O modelo separa eventos reservados para IA/automação futura de eventos que o worker desta fase consome, para não descartá-los antes das Fases 6/7.

Retenção proposta do implementador: envelope normalizado operacional por 30 dias; payload bruto não armazenado por padrão; intenções e histórico permanecem. Eventos necessários ainda não processados não são removidos pela limpeza. Auditoria registra alterações de regras e conexão.

## Testes e definição de concluído

- Unitários: providers com fetch injetado, assinaturas do corpo bruto, fixtures de lote, limites, classificação de stories/comentários, seleção de destinatário e palavras-chave.
- SQL/pgTAP: isolamento, privilégios do Vault, conexão/canal, deduplicação e fila na mesma transação, estado monotônico, corrida de claim, precedência de regras e desativação.
- Integração Edge local: callbacks assinados, challenge, rejeição de assinatura/JWT inválido, tentativas de atravessar organizações, processamento/reconciliação e timeout incerto.
- E2E: administrador configura/testa canal, agente não acessa segredos, evento assinado aparece no Inbox e CRM, atendente responde, entrega atualiza, regra ativa gera uma resposta privada única no transporte de teste.
- Regressão: testes existentes da Fase 4, lint e typecheck; verificar interface em desktop/mobile.

O transporte de teste só existe na infraestrutura de teste com fetch injetado/servidor local, nunca como opção que ativa um canal real em produção. A conclusão sem app Meta significa implementação verificada localmente; validação ao vivo fica pendente e é relatada separadamente. Não afirmar que um canal real está conectado sem confirmação da Meta.

## Atualização proposta do MVP

Esta proposta inicia a Fase 5 somente com Instagram, incluindo comentários por palavra-chave e contexto de stories. A integração com WhatsApp fica adiada por decisão do usuário e exige plano próprio antes de começar. Para a Fase 7, o escopo passa a incluir gatilhos de comentário/story, links/QR de entrada, botões/respostas rápidas, sequências com espera de dias e campanhas segmentadas sujeitas às permissões de cada canal. Após a Fase 10: anexos/mídia, modelos aprovados do WhatsApp (dependentes da conexão futura), Google Sheets/Shopify, galeria de fluxos e avaliação de Messenger. Esses itens não fazem parte da implementação da Fase 5.

Depois da aprovação, incorporar essa atualização ao design geral e criar o plano detalhado. Onde divergir, a proposta específica aprovada substitui Page ID/Facebook Login por Instagram Login e agrupa o app secret/verify token na conexão de app, mantendo access tokens por canal.

## Fontes e verificação

- [Coleção oficial Meta — Instagram API](https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00): Instagram Login, contas profissionais, permissões e Send API.
- [Supabase Vault](https://supabase.com/docs/guides/database/vault): armazenamento e proteção de acesso à view de segredos decifrados.
- Consulta em 2026-10-12. As páginas diretas de developers.facebook.com retornaram limitação de acesso nesta sessão. A regra de comentários/stories exige conferência adicional do contrato durante o planejamento; não registrar janela/endpoint não verificado como fato.
