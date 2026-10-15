# Convite público para o grupo VIP

## Objetivo e escopo confirmado

Sem IA, responder a comentários em todas as publicações do perfil conectado com o texto exato:

> Quer entrar no nosso grupo VIP do WhatsApp? Comente VIP para receber o link no Direct.

Quando o comentário contiver a palavra VIP, enviar pelo Direct o convite para https://chat.whatsapp.com/FFHuLdtAehRCoIDP67bX5r . Esse envio deve usar o mecanismo oficial de resposta privada a comentário existente, sem contornar suas restrições.

## Decisões propostas pelo implementador

- Considerar somente comentários criados depois da ativação, inclusive em publicações antigas. Não consultar o histórico para disparos retroativos.
- Responder uma vez por comentário elegível. Ignorar comentários da própria conta e respostas geradas pelo sistema. Confirmar a autoria e a propriedade da publicação antes de enviar; identidade ambígua impede envio.
- Manter a regra pública independente da seleção da automação privada: uma não deve consumir o evento da outra.
- Para comentários VIP, o envio privado pode ocorrer junto da resposta pública solicitada. Não trocar o texto público sem autorização.
- Palavra VIP deve ser reconhecida sem distinção de maiúsculas, como palavra inteira, evitando correspondências como VIPER. Preservar os modos existentes nas demais automações.
- Texto privado padrão: "Aqui está o convite para o nosso grupo VIP do WhatsApp: https://chat.whatsapp.com/FFHuLdtAehRCoIDP67bX5r".
- Não aplicar automaticamente o limite de 30 por dia discutido para mensagens a seguidores à nova regra pública. Respeitar limites da API, com fila e pausa em bloqueios; não prometer um volume livre de restrições.
- Configuração inicialmente desativada, com prévia dos dois textos e opção de ativar/desativar. Nenhum teste deve publicar comentários ou enviar mensagens reais.

## Arquitetura e restrições

Usar a integração Instagram, autenticação, isolamento por organização e fila existentes. O código atual usa `private_reply` para Direct; resposta pública é uma operação distinta, sem criar mensagem fictícia no inbox nem abrir janela de atendimento.

Adicionar persistência de configuração pública por canal e intenções públicas únicas por canal/comentário. A intenção deve ter estados pendente, enviando, enviada, falha e resultado incerto. A reserva deve ser atômica. Timeout, falha de rede ou resposta ambígua após POST não podem provocar repetição automática. Reinício após reserva também exige resultado incerto/reconciliação, sem novo POST cego. A regra deve ser revalidada antes da reserva e cancelada quando desativada ou o canal desconectado.

Verificar em documentação primária Meta o endpoint e a permissão para resposta pública antes da implementação do provedor. Não presumir que a permissão para Direct autoriza comentários. Se faltar permissão, mostrar instrução de reconexão e impedir ativação/envio.

Validar assinatura dos eventos como hoje. Verificar conta, organização, mídia e autor em dados oficiais; não confiar somente no identificador informado pelo webhook. Identificadores app-scoped devem respeitar a resolução de identidade já usada pela integração. Ignorar comentários excluídos, inacessíveis ou anteriores à ativação.

Inspecionar suporte a comentários em threads na API. Se o evento não permitir determinar com segurança se é resposta da própria conta, não enviar. Não criar laços ao receber o webhook da resposta publicada.

## Verificação necessária

Testes de provedor com transporte simulado; testes de isolamento, permissões, reserva concorrente, eventos duplicados, desativação, desconexão, ativação temporal e resultado incerto no banco; testes de worker para mídia de outra conta, próprio autor, limitação da API e convivência dos dois fluxos; teste da prévia e configuração na interface. Executar tipos e testes relevantes após alteração, sem chamadas reais à Meta e sem reinicializar banco.

## Fora do escopo

Mensagens a seguidores ou curtidores sem solicitação, IA, importação histórica, automação de navegador e adesão automática ao grupo WhatsApp. O usuário escolhe entrar ao abrir o convite.

## Estado

Escopo, link e desenho completo aprovados pelo usuário em 2026-10-14. Revisão independente do desenho: nenhuma questão importante em aberto. Implementação na branch local `codex/instagram-public-vip`. Nenhum recurso foi ativado.
