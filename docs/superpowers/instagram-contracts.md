# Contratos Instagram — verificados em 2026-10-12

Configuração: Instagram API com Instagram Login. Versão é fornecida pela conexão; fixtures usam `v26.0`, versão encontrada nos exemplos oficiais consultados. Não significa que uma conexão será atualizada automaticamente.

## Matriz

| Capacidade | Contrato verificado | Uso |
|---|---|---|
| Direct | POST graph.instagram.com/{version}/{account_id}/messages, recipient.id e message.text | Texto UTF-8 até 1.000 bytes; janela comum de 24h após inbound elegível |
| Private reply | Mesmo endpoint, recipient.comment_id | Uma resposta, até 7 dias após comentário de post/Reel; continuação somente após resposta do usuário |
| Stories | message.reply_to.story e attachment type story_mention | Contexto no Inbox; não baixar URLs de mídia |
| Mensagem | object instagram; entry[].messaging[] com sender/recipient/timestamp/message.mid | Não tratar is_echo/is_self/is_deleted como entrada nova |
| Comentário | field comments; value.id/from/text/media; exemplos incluem entrada direta e changes | Registro específico, nunca inbound artificial |
| Leitura recebida | entry[].messaging[].read.mid, messaging_seen | Estado read da mensagem externa exata |
| Entrega | Nenhum receipt delivered identificado no contrato consultado | Não sintetizar delivered após API aceitar |
| Perfil | GET /{IGSID}?fields=name,username; bearer token | Nome opcional; falha não deve perder inbound |
| Assinatura | X-Hub-Signature-256; HMAC SHA256 do corpo bruto | Web Crypto verify, antes de JSON |
| Confirmação de leitura enviada | Documentação sender-actions inconsistente entre host Facebook e Instagram Login | Capability pendente, leitura local continua funcional; não emitir chamada presumida |

Permissões mínimas: instagram_business_basic e instagram_business_manage_messages; comentários exigem instagram_business_manage_comments. Subscrições desta fase: messages, comments e messaging_seen. Live não faz parte do escopo.

Instalar callback no app e habilitar notificações na conta profissional são passos distintos. O teste da conexão deve verificar identidade, permissões e subscrições da conta, além da confirmação GET do callback. Um GET de challenge sozinho não comprova entrega de mensagens.

## Fontes primárias consultadas

- [Send API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/)
- [Private replies](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/private-replies/)
- [Webhook examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples)
- [Webhook fields](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields)
- [Webhook setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup)
- [Graph webhook signature](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/)
- [User profile](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile/)
- [Sender actions](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/sender-actions)
- [/me](https://developers.facebook.com/documentation/instagram-platform/reference/me)

Acesso direto HTTPS à documentação oficial funcionou; snapshots temporários ficam no workspace ignorado desta execução. Não há confirmação ao vivo com conta Meta nesta data.
