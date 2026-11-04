# Recuperação de carrinhos: roteiro de troca e retorno

Troca da recuperação manual do Recovery Hub (Next + Prisma + Postgres, em `C:\Users\thiag\OneDrive\Área de Trabalho\Recovery Hub`) para a tela **Carrinhos** do FlowAI. Nenhum passo abaixo deve ser feito sem decisão explícita do proprietário. Não anote senhas, chaves ou segredos neste arquivo nem em conversas: use o gerenciador de senhas.

## 1. Antes da troca

1. Faça um backup restaurável do banco do Recovery Hub. Ele sobe com o próprio `docker-compose.yml` (serviço `postgres`, banco `recovery_hub`). Com o compose ligado, rode `pg_dump` dentro do contêiner do Postgres (formato custom, `-Fc`) e guarde o arquivo fora da pasta do projeto e fora do OneDrive público. Confirme o backup restaurando-o em um banco descartável e conferindo as contagens. Não rode nada que apague o volume `postgres_data`.
2. Anote **só contagens**, sem nomes, e-mails ou telefones: carrinhos abertos, atendimentos pendentes e clientes bloqueados.
3. Exporte os bloqueios e as autorizações de contato conhecidos do Recovery Hub e registre-os no FlowAI, um a um, na tela do carrinho (botões **Autorização de contato** e **Bloquear cliente**). Use a origem e a data reais da evidência de cada cliente. Sem evidência real, não registre autorização.
4. Defina a **data de corte**: a partir dela, carrinhos novos são atendidos só no FlowAI. Anote a data e a hora.

## 2. Configurar o FlowAI

1. Em **Configurações > Carrinhos**, cadastre os **hosts de checkout** permitidos (só o domínio, por exemplo o da loja e o do checkout da Yampi). Links de retomada de outro host ficam bloqueados.
2. No mesmo lugar, revise o **modelo da mensagem de WhatsApp** (variáveis `{primeiro_nome}`, `{loja}`, `{valor}`, `{itens}`, `{link}`).
3. Confirme que a conexão com a loja existe e que os testes locais passam (`npm test`, `npm run test:edge`, `npx supabase test db` e o e2e `carts.spec.ts`).

## 3. Troca do webhook na Yampi

1. No painel da Yampi, confira onde se edita a URL e o segredo do webhook existente (o que aponta para o Recovery Hub).
2. Anote a configuração anterior (URL e identificação do segredo, não o valor) em local seguro, para o retorno.
3. Aponte o webhook para a URL da função `yampi-webhook` do FlowAI, com o segredo do FlowAI (ver `docs/superpowers/emails-setup.md`, seção 4).
4. **Não exclua** o webhook antigo antes de confirmar que o novo funciona (passo 4 abaixo).

## 4. Validação

1. Com autorização específica do proprietário, faça um abandono real e um pagamento controlado, ambos na conta do proprietário.
2. Confira na tela **Carrinhos**: o carrinho aparece, o pagamento muda o estado para **Pago** ("Pagamento confirmado") e as ações de WhatsApp ficam bloqueadas.
3. Só então considere a troca concluída.

## 5. Retorno (se algo falhar)

1. No painel da Yampi, reaponte o webhook para o Recovery Hub com a configuração anotada no passo 3.2.
2. Suba o Recovery Hub (`Ligar Recovery Hub.cmd` ou `docker compose up`) e confirme que recebe um evento.
3. Carrinhos recebidos no intervalo continuam consultáveis no FlowAI; não apague nada.
4. Se o banco do Recovery Hub foi afetado, restaure o backup do passo 1.1 em um banco novo e compare as contagens antes de substituir.

## 6. Pendências antigas

1. Atendimentos abertos antes da data de corte seguem no Recovery Hub até serem encerrados ou respondidos.
2. Não migre histórico de mensagens nem recrie atendimentos antigos no FlowAI.
3. Quando as contagens de pendentes chegarem a zero, o Recovery Hub pode ser desligado (guarde o último backup).

## 7. E-mails e cron

A ativação dos e-mails automáticos e do cron é uma etapa **separada** e posterior (ver `docs/superpowers/emails-setup.md`). Antes de ativá-los, coordene com a recuperação nativa da Yampi para o cliente não receber mensagens duplicadas do mesmo carrinho.
