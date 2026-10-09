begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

select tests.create_user('a@t.test') as ua \gset
select tests.create_user('b@t.test') as ub \gset
select tests.create_user('view@t.test') as uview \gset
select tests.create_user('agent@t.test') as uagent \gset
select tests.create_user('admin@t.test') as uadmin \gset
select tests.create_org(:'ua', 'Org A') as org_a \gset
select tests.create_org(:'ub', 'Org B') as org_b \gset
select tests.add_member(:'org_a', :'uview', 'viewer');
select tests.add_member(:'org_a', :'uagent', 'agent');
select tests.add_member(:'org_a', :'uadmin', 'admin');

-- fixtures (postgres)
insert into public.contacts (id, organization_id, name) values
  ('00000000-0000-0000-0000-0000000000c1', :'org_a', 'Contato A'),
  ('00000000-0000-0000-0000-0000000000c2', :'org_b', 'Contato B');
insert into public.channels (id, organization_id, type, name, external_account_id, access_token_secret_id) values
  ('00000000-0000-0000-0000-0000000000d1', :'org_a', 'whatsapp', 'WA A', 'phone-1', gen_random_uuid()),
  ('00000000-0000-0000-0000-0000000000d2', :'org_b', 'whatsapp', 'WA B', 'phone-2', null);
insert into public.conversations (id, organization_id, contact_id, channel_id) values
  ('00000000-0000-0000-0000-0000000000e1', :'org_a', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000e2', :'org_b', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000d2');
insert into public.messages (id, organization_id, conversation_id, channel_id, direction, sender_type, content) values
  ('00000000-0000-0000-0000-0000000000f1', :'org_a', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'inbound', 'contact', 'oi'),
  ('00000000-0000-0000-0000-0000000000f2', :'org_b', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d2', 'inbound', 'contact', 'oi B');

-- segredos protegidos por privilégio de coluna
select tests.authenticate_as(:'ua');
select throws_ok($$select access_token_secret_id from public.channels$$, '42501', null, 'owner não lê access_token_secret_id');
select throws_ok($$select * from public.channels$$, '42501', null, 'select * em channels falha (colunas secretas)');
select lives_ok($$select id, name, status from public.channels$$, 'owner lê colunas não secretas');
select is((select count(*)::int from public.channels), 1, 'A vê só canais de A');
select throws_ok(format($$update public.channels set app_secret_secret_id = gen_random_uuid() where organization_id = %L$$, :'org_a'), '42501', null, 'owner não atualiza secret id');

-- canais: admin+ escreve
select lives_ok(format($$insert into public.channels(organization_id, type, name) values (%L, 'instagram', 'IG A')$$, :'org_a'), 'owner insere canal');
select tests.authenticate_as(:'uadmin');
select lives_ok($$update public.channels set name = 'WA A2' where id = '00000000-0000-0000-0000-0000000000d1'$$, 'admin renomeia canal');
select tests.authenticate_as(:'uagent');
select throws_ok(format($$insert into public.channels(organization_id, type, name) values (%L, 'instagram', 'IG X')$$, :'org_a'), '42501', null, 'agent não insere canal');
select tests.authenticate_as(:'ub');
select throws_ok(format($$insert into public.channels(organization_id, type, name) values (%L, 'instagram', 'IG X')$$, :'org_a'), '42501', null, 'B não insere canal em A');

-- isolamento
select is((select count(*)::int from public.conversations where organization_id = :'org_a'), 0, 'B não vê conversas de A');
select is((select count(*)::int from public.messages where organization_id = :'org_a'), 0, 'B não vê mensagens de A');
select tests.authenticate_as(:'uview');
select is((select count(*)::int from public.messages), 1, 'viewer lê mensagens da própria org');

-- conversas: agent+ atualiza, viewer não; sem delete
select tests.authenticate_as(:'uagent');
select lives_ok(format($$update public.conversations set status = 'pending_human', handled_by = 'human', assigned_to = %L where id = '00000000-0000-0000-0000-0000000000e1'$$, :'uagent'), 'agent atualiza status/handler/assignee');
select throws_ok($$update public.conversations set summary = 'x' where id = '00000000-0000-0000-0000-0000000000e1'$$, '42501', null, 'agent não edita summary (grant de coluna)');
select tests.authenticate_as(:'uview');
update public.conversations set status = 'closed' where id = '00000000-0000-0000-0000-0000000000e1';
select tests.clear_authentication();
select is((select status::text from public.conversations where id = '00000000-0000-0000-0000-0000000000e1'), 'pending_human', 'viewer não altera conversa');
select tests.authenticate_as(:'uagent');
select throws_ok($$delete from public.conversations where id = '00000000-0000-0000-0000-0000000000e1'$$, '42501', null, 'sem delete em conversas');

-- mensagens
select lives_ok(format($$insert into public.messages(organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content)
  values (%L, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'outbound', 'human', %L, 'olá')$$, :'org_a', :'uagent'), 'agent insere mensagem humana outbound');
select lives_ok(format($$insert into public.messages(organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content, is_internal_note)
  values (%L, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'outbound', 'human', %L, 'nota', true)$$, :'org_a', :'uagent'), 'agent insere nota interna');
select throws_ok(format($$insert into public.messages(organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content)
  values (%L, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'outbound', 'ai', %L, 'x')$$, :'org_a', :'uagent'), '42501', null, 'agent não insere sender_type ai');
select throws_ok(format($$insert into public.messages(organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content)
  values (%L, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'outbound', 'human', %L, 'x')$$, :'org_a', :'ua'), '42501', null, 'agent não forja sender_user_id');
select throws_ok(format($$insert into public.messages(organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content)
  values (%L, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'inbound', 'human', %L, 'x')$$, :'org_a', :'uagent'), '42501', null, 'agent não insere inbound');
select lives_ok($$update public.messages set status = 'failed', error = 'boom' where id = '00000000-0000-0000-0000-0000000000f1'$$, 'agent atualiza status/error da mensagem');
select throws_ok($$update public.messages set content = 'editado' where id = '00000000-0000-0000-0000-0000000000f1'$$, '42501', null, 'conteúdo da mensagem é imutável');
select throws_ok($$delete from public.messages where id = '00000000-0000-0000-0000-0000000000f1'$$, '42501', null, 'sem delete em mensagens');
select tests.authenticate_as(:'uview');
select throws_ok(format($$insert into public.messages(organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content)
  values (%L, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'outbound', 'human', %L, 'x')$$, :'org_a', :'uview'), '42501', null, 'viewer não insere mensagem');

-- FK composta: conversa de A não pode apontar para canal de B
select tests.clear_authentication();
select throws_ok(format($$insert into public.conversations(organization_id, contact_id, channel_id)
  values (%L, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2')$$, :'org_a'), '23503', null, 'FK composta impede canal de outra org');

-- dedup
select throws_ok(format($$insert into public.messages(organization_id, conversation_id, channel_id, direction, sender_type, content, external_id)
  select %L, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'inbound', 'contact', 'dup', 'wamid.1' from generate_series(1,2)$$, :'org_a'), '23505', null, 'external_id duplicado por canal');

-- realtime
select ok(exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'), 'realtime inclui messages');
select ok((select count(*) = 3 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('messages','conversations','deals')), 'realtime inclui messages, conversations, deals');

select * from finish();
rollback;
