# Recuperação de carrinhos: roteiro de troca e retorno

Troca da recuperação manual do Recovery Hub (Next + Prisma + Postgres, na pasta do Recovery Hub no seu computador) para a tela **Carrinhos** do FlowAI. Nenhum passo abaixo deve ser feito sem decisão explícita do proprietário. Não anote senhas, chaves ou segredos neste arquivo nem em conversas: use o gerenciador de senhas.

## 1. Antes da troca

1. Faça um backup restaurável do banco do Recovery Hub. Ele usa um PostgreSQL 17 **embutido** (`npm run db:local`), com os dados em `.local\postgres` dentro da pasta do Recovery Hub — o `docker-compose.yml` dele não guarda os dados reais. Com o Recovery Hub desligado, copie a pasta `.local\postgres` inteira para fora do projeto e do OneDrive (ex.: `C:\Users\<você>\Backups\recovery-hub\<data>\postgres`). Confirme o backup ligando uma cópia dessa pasta em outra porta (`pg_ctl` de `node_modules\@embedded-postgres\windows-x64\native\bin`, `-p 5433`) e conferindo as contagens; depois desligue e apague só essa cópia de teste. Feito em 04/11/2026: ver `LEIA-ME.txt` na pasta do backup.
2. Anote **só contagens**, sem nomes, e-mails ou telefones: carrinhos abertos, atendimentos pendentes, clientes bloqueados e autorizações de contato.
3. Exporte os bloqueios e as autorizações de contato conhecidos do Recovery Hub e registre-os no FlowAI, um a um, na tela do carrinho (botões **Autorização de contato** e **Bloquear cliente**). Use a origem e a data reais da evidência de cada cliente. Sem evidência real, não registre autorização. Guarde as contagens exportadas para a conferência do passo 5.4.
4. Defina a **data de corte**: a partir dela, carrinhos novos são atendidos só no FlowAI. Anote a data e a hora na lista de verificação abaixo e também no próprio Recovery Hub (uma observação visível para quem ainda atende por lá).

- [x] Data de corte: 04/11/2026 às 08:45 (horário de Brasília). Anotar também no Recovery Hub.

## 2. Configurar o FlowAI

1. Em **Configurações > Carrinhos**, cadastre os **hosts de checkout** permitidos (só o domínio, por exemplo o da loja e o do checkout da Yampi). Links de retomada de outro host ficam bloqueados.
2. No mesmo lugar, revise o **modelo da mensagem de WhatsApp** e decida se o **celular informado no checkout vale como autorização de WhatsApp** (opção da loja; revogação e bloqueio continuam vencendo) (variáveis `{primeiro_nome}`, `{loja}`, `{valor}`, `{itens}`, `{link}`).
3. Confirme que a conexão com a loja existe e que os testes locais passam (`npm test`, `npm run test:edge`, `npx supabase test db` e o e2e `carts.spec.ts`).

## 3. Publicação

Os passos do Supabase são executados pelo **proprietário**, não pelo Claude. Siga esta ordem:

1. Publique a função do webhook. Ela leva o leitor atualizado da Yampi; sem ela, os carrinhos chegam sem a data do abandono e com telefones crus.

```bash
npx supabase functions deploy yampi-webhook
```

2. Aplique as migrações `20261105000001` a `20261105000004` (a `…03` corrige os telefones dos contatos já existentes; a `…04` cria a opção de autorização pelo checkout).

```bash
npx supabase db push
```

3. Faça o merge do ramo `feat/recuperacao-unificada` em `master` e envie. A Vercel publica o app web.

```bash
git push
```

4. A jornada de e-mails e o cron continuam como estão (desligada e pausado). Não os ative nesta etapa (ver seção 8).

## 4. Troca do webhook na Yampi

1. No painel da Yampi, confira onde se edita a URL e o segredo do webhook existente (o que aponta para o Recovery Hub).
2. Anote a configuração anterior (URL e identificação do segredo, não o valor) em local seguro, para o retorno.
3. Aponte o webhook para a URL da função `yampi-webhook` do FlowAI, com o segredo do FlowAI (ver `docs/superpowers/emails-setup.md`, seção 4).
4. **Não exclua** o webhook antigo antes de confirmar que o novo funciona (seção 5 abaixo).

## 5. Validação

1. Com autorização específica do proprietário, faça um abandono real e um pagamento controlado, ambos na conta do proprietário.
2. Confira na tela **Carrinhos**: o carrinho aparece, o pagamento muda o estado para **Pago** ("Pagamento confirmado") e as ações de WhatsApp ficam bloqueadas.
3. Confira um carrinho real de ponta a ponta na tela: o telefone válido aparece mascarado, o **Link de retomada** aparece como permitido, a autorização de contato aparece registrada e **Preparar mensagem** mostra a mensagem. Não envie a mensagem sem autorização específica do proprietário.
4. Reconte os bloqueios e as autorizações registrados no FlowAI e compare com as contagens exportadas do Recovery Hub (passo 1.3). Diferença = registrar o que falta antes de seguir.
5. Só então considere a troca concluída.

## 6. Retorno (se algo falhar)

1. No painel da Yampi, reaponte o webhook para o Recovery Hub com a configuração anotada no passo 4.2.
2. Suba o Recovery Hub (`Ligar Recovery Hub.cmd` ou `docker compose up`) e confirme que recebe um evento.
3. Carrinhos recebidos no intervalo continuam consultáveis no FlowAI; não apague nada.
4. Se o banco do Recovery Hub foi afetado, restaure o backup do passo 1.1 em um banco novo e compare as contagens antes de substituir.

## 7. Pendências antigas

1. Atendimentos abertos antes da data de corte seguem no Recovery Hub até serem encerrados ou respondidos.
2. Não migre histórico de mensagens nem recrie atendimentos antigos no FlowAI.
3. Quando as contagens de pendentes chegarem a zero, o Recovery Hub pode ser desligado (guarde o último backup).

## 8. E-mails e cron

A ativação dos e-mails automáticos e do cron é uma etapa **separada** e posterior (ver `docs/superpowers/emails-setup.md`). Antes de ativá-los, coordene com a recuperação nativa da Yampi para o cliente não receber mensagens duplicadas do mesmo carrinho.
