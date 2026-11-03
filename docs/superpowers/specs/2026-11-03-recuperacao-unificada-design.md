# Recuperação de carrinhos unificada no FlowAI

Status: proposta para aprovação; nenhuma implementação ou mudança de produção autorizada por este documento.

## Objetivo

Operar a recuperação de carrinhos da Holy Spirit no FlowAI, com uma conexão Yampi para receber abandonos e pagamentos, e-mail via Resend e atendimento manual pelo WhatsApp. Aproveitar as regras do Recovery Hub sem transportar sua infraestrutura local nem perder seu histórico.

## Alternativas

1. **Incorporar o atendimento manual no FlowAI — recomendação.** Uma base de carrinhos e um receptor Yampi; adaptar regras úteis do Recovery Hub. Exige desenvolver a tela e as operações manuais, mas evita sincronizar dois bancos.
2. **Encaminhar eventos para os dois sistemas.** Mantém o Recovery Hub operacional, mas exige entrega independente, repetição, monitoramento e assinaturas corretas para cada destino. Mantém dependência do computador local. Fora da proposta mínima.
3. **Manter só os e-mails existentes.** Menor trabalho, mas não incorpora o atendimento manual que motivou a unificação.

A recomendação é uma proposta do implementador, ainda sujeita à aprovação do usuário.

## Evidências do código atual

- FlowAI: `store_connections`, `store_events`, `store_carts`, `store_orders`, contatos e jornadas de e-mail já existem em `supabase/migrations/20261104000001_store_emails.sql`.
- `packages/core/src/store/yampi.ts` normaliza os quatro eventos existentes e telefone, mas não preserva a data original do abandono nem todo o estado comercial necessário ao atendimento manual. Esses contratos precisam ser ampliados com fixtures verificadas.
- Recovery Hub: `server/recovery/contacts.ts` separa abertura do WhatsApp e confirmação humana do envio, evita repetição e registra histórico; `lib/crm/contracts.ts` bloqueia contato em carrinhos pagos, pausados ou suprimidos; `server/recovery/followups.ts` implementa uma agenda mais ampla, adiada nesta primeira entrega.
- Recovery Hub usa Prisma, PostgreSQL e Redis/BullMQ locais; FlowAI usa Supabase e autenticação por organização. Reaproveitar comportamento e testes, não copiar a camada de persistência ou o acesso local sem login.
- Produção FlowAI permanece com jornada desligada e processamento de e-mail pausado. Resend configurado; assinatura real Yampi, entrega e retomada do checkout ainda exigem homologação.

## Primeira entrega

### Carrinhos

Uma área Carrinhos no menu, com lista paginada, busca por cliente, período, estado comercial e estágio de atendimento. Exibir cliente, valor, itens, data original do abandono quando disponível e telefone válido. Data de recebimento não será apresentada como data original se esta faltar.

Detalhe com itens, link de retomada validado, estado comercial, histórico de e-mails e histórico manual. Separar compra/pagamento de estágio do atendimento; criar pedido não significa pagamento. Sem associação comprovada entre pedido e carrinho, mostrar pagamento não reconciliado em vez de marcar recuperação.

### WhatsApp manual, sem IA

Modelo inicial simples editável pelo administrador, mensagem revisável pelo operador e botão Abrir WhatsApp. Nunca disparar mensagens automaticamente. Abrir o aplicativo não conta como envio nem entrega. Registrar envio somente por confirmação explícita, com operador e horário; repetição exige nova confirmação e operações repetidas por falha de rede não duplicam registros.

Pausar, retomar e encerrar atendimento, registrar resposta e bloquear futuros contatos pelo WhatsApp. Telefone inválido, compra confirmada, pausa, encerramento, bloqueio ou link inseguro impedem a ação correspondente. Revalidar elegibilidade no servidor imediatamente antes de liberar mensagem/link e confirmar contato. Não presumir consentimento porque o telefone está no checkout; preservar permissões e bloqueios conhecidos e sinalizar ausência de informação. Proposta para esta entrega: ausência de autorização de contato registrada bloqueia a abertura e confirmação pelo módulo; o operador pode registrar autorização com origem e data verificáveis, nunca por marcação automática ou declaração inventada. Revogação posterior prevalece e exige nova autorização comprovada para retomada.

### E-mail existente

Preservar a jornada de 60 minutos, 24 horas e 48 horas, cupom opcional, descadastro e cancelamento por compra. Mostrar seus registros no detalhe sem criar uma segunda fila. Bloqueio específico do WhatsApp e descadastro de e-mail continuam distintos; bloqueio geral de contato alcança os dois. Pausa/encerramento do atendimento manual não implica desligar e-mails: a tela deve explicitar o alcance e permitir interromper os dois quando solicitado.

### Segurança e dados

Reutilizar autenticação, organização ativa, papéis e RLS do FlowAI. Administradores configuram; operadores autorizados atendem; leitura não autoriza escrita. URLs de retomada devem ser HTTPS de domínios de checkout expressamente autorizados; nunca expor segredos no cliente, histórico ou logs. Eventos repetidos e fora de ordem não podem reabrir carrinho pago nem criar contatos duplicados indevidamente.

## Preservação do Recovery Hub

Primeira entrega não importa automaticamente o banco antigo. Preservar aplicação, banco e cópia de segurança restaurável; consultar o histórico antigo no Recovery Hub. O FlowAI assume novos eventos a partir da troca. Assim não inventa históricos e não agenda mensagens para carrinhos antigos.

Antes da troca, levantar contagens de carrinhos abertos, atendimentos pendentes e bloqueios conhecidos, sem publicar dados pessoais. Exportar e reconciliar bloqueios de contato necessários antes de permitir atendimento no FlowAI. Pendências antigas continuam no sistema antigo até serem encerradas, com data de corte visível. Importação de histórico completo é uma etapa separada se o usuário desejar.

## Etapas propostas

1. **Fundação e estados:** ampliar normalização e persistência existente, separar estágio manual de estado comercial, adicionar histórico manual e bloqueios por canal. Testar organização, permissão, duplicação, ordem de eventos e compra anterior ao abandono recebido.
2. **Lista e detalhe:** consultas paginadas e tela com carrinho e históricos reais. Testar filtros, ausência de dados, erro de carregamento e acesso entre organizações.
3. **Atendimento manual:** modelo, revisão, abertura do WhatsApp, confirmação humana, pausa e bloqueio. Testar telefone inválido, URL maliciosa, pagamento entre abertura e confirmação e repetição de clique. Não confirmar automaticamente envio.
4. **Homologação isolada:** testes de banco, aplicação e navegador com dados sintéticos; preservar regressões de e-mail e Instagram. Preparar backup, corte e retorno documentados. Nenhum envio real nesta etapa.
5. **Troca controlada:** preparar uma configuração completa e revisável para substituir o destino do webhook Recovery Hub pelo FlowAI, mantendo os outros conectores. Conferir como a Yampi permite editar URL e segredo antes de agir; não excluir o webhook por antecipação. Guardar configuração anterior com segurança para retorno. Validar abandono real e pagamento controlado com conta do proprietário, mediante autorização específica.
6. **Ativação separada:** revisar destinatários de teste, conteúdo e mecanismos contra duplicação. Somente após aprovação dos testes, autorizar envio de teste e posteriormente jornada/processador. Coordenar recuperação nativa da Yampi apenas nessa ativação, para evitar e-mails duplicados; não alterá-la durante desenvolvimento.

## Critérios de aceite

- Um receptor Yampi serve ao módulo de e-mail e à tela de carrinhos do FlowAI.
- Usuário identifica carrinho aberto e pago e executa contato manual com registro fiel.
- Abrir WhatsApp não é contabilizado como mensagem enviada ou entregue.
- Pagamento, bloqueio e isolamento de organização prevalecem sobre ações concorrentes.
- Não há contato ou disparo retroativo causado por migração ou ativação.
- Histórico antigo é preservado, pendências têm responsável e bloqueios relevantes são reconciliados antes do corte.
- Existe roteiro de retorno ao webhook anterior e os envios continuam desligados até aprovação específica.

## Fora desta entrega

IA, disparo automático de WhatsApp, importação completa do banco antigo, agenda avançada de follow-ups, relatórios por campanha, novo CRM genérico e encaminhador para dois sistemas. Não adicionar Redis, Prisma ou um worker local ao FlowAI.

## Decisões deixadas ao implementador

Nomes de novas tabelas/RPCs, composição de componentes e casos de teste seguem os padrões existentes e serão fixados no plano técnico após aprovação deste desenho. A primeira entrega usa uma mensagem configurável e histórico, sem sequência automática de lembretes manuais. Se os dados reais não permitirem reconciliar pagamento de forma confiável, bloquear ativação até resolver o contrato, sem associação por aproximação.

## Aprovação pendente

Confirmar a abordagem recomendada e a preservação do histórico antigo no Recovery Hub, sem importação completa nesta primeira entrega. Após essa aprovação, elaborar o plano técnico de implementação com arquivos, interfaces e testes específicos.
