begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

select tests.create_user('a19@t.test', 'Dona') as ua \gset
select tests.create_user('b19@t.test', 'Outro') as ub \gset
select tests.create_user('ana19@t.test', 'Ana') as uana \gset
select tests.create_user('bruno19@t.test', 'Bruno') as ubruno \gset
select tests.create_user('view19@t.test', 'Vera') as uview \gset
select tests.create_org(:'ua', 'Org A19') as org_a \gset
select tests.create_org(:'ub', 'Org B19') as org_b \gset
select tests.add_member(:'org_a', :'uana', 'agent');
select tests.add_member(:'org_a', :'ubruno', 'agent');
select tests.add_member(:'org_a', :'uview', 'viewer');

insert into public.contacts (id, organization_id, name) values
  ('00000000-0000-0000-0000-000000001901', :'org_a', 'Contato 19');
insert into public.channels (id, organization_id, type, name, status) values
  ('00000000-0000-0000-0000-000000001911', :'org_a', 'simulator', 'Sim A', 'active');
insert into public.conversations (id, organization_id, contact_id, channel_id, last_message_at) values
  ('00000000-0000-0000-0000-000000001921', :'org_a', '00000000-0000-0000-0000-000000001901',
   '00000000-0000-0000-0000-000000001911', '2026-01-01 10:00:00+00');

-- um simulador por organização
select throws_ok(format($$insert into public.channels (organization_id, type, name) values (%L, 'simulator', 'Sim A2')$$, :'org_a'),
  '23505', null, 'segundo canal simulator na mesma org falha');
select lives_ok(format($$insert into public.channels (organization_id, type, name) values (%L, 'simulator', 'Sim B')$$, :'org_b'),
  'simulator em outra org é permitido');

-- closed_at pelo gatilho
select tests.authenticate_as(:'uana');
select throws_ok($$update public.conversations set closed_at = now()$$, '42501', null, 'agent não escreve closed_at');
update public.conversations set status = 'closed' where id = '00000000-0000-0000-0000-000000001921';
select tests.clear_authentication();
select isnt((select closed_at from public.conversations where id = '00000000-0000-0000-0000-000000001921'), null, 'fechar preenche closed_at');
select tests.authenticate_as(:'uana');
update public.conversations set status = 'open' where id = '00000000-0000-0000-0000-000000001921';
select tests.clear_authentication();
select is((select closed_at from public.conversations where id = '00000000-0000-0000-0000-000000001921'), null, 'reabrir limpa closed_at');

-- identidade do canal em contacts
select tests.authenticate_as(:'uana');
select throws_ok(format($$insert into public.contacts (organization_id, name, source) values (%L, 'X', 'whatsapp')$$, :'org_a'),
  '42501', null, 'agent não insere source');
select throws_ok(format($$insert into public.contacts (organization_id, name, whatsapp_id) values (%L, 'X', 'w1')$$, :'org_a'),
  '42501', null, 'agent não insere whatsapp_id');
select throws_ok(format($$insert into public.contacts (organization_id, name, instagram_id) values (%L, 'X', 'i1')$$, :'org_a'),
  '42501', null, 'agent não insere instagram_id');
select throws_ok(format($$insert into public.contacts (organization_id, name, last_interaction_at) values (%L, 'X', now())$$, :'org_a'),
  '42501', null, 'agent não insere last_interaction_at');
select public.save_contact(:'org_a', null, '{"name":"Novo19","phone":"+5511900001919"}'::jsonb, null, null) as cid \gset
select tests.clear_authentication();
select is((select source::text from public.contacts where id = :'cid'), 'manual', 'save_contact cria contato com source manual');

-- log_conversation_system_message
select tests.authenticate_as(:'uana');
select public.log_conversation_system_message('00000000-0000-0000-0000-000000001921', 'assigned', :'ubruno');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where conversation_id = '00000000-0000-0000-0000-000000001921' and sender_type = 'system'), 1, 'uma mensagem de sistema');
select is((select content from public.messages where conversation_id = '00000000-0000-0000-0000-000000001921' and sender_type = 'system'),
  'Ana transferiu para Bruno', 'texto de transferência');
select is((select direction::text || '/' || status::text || '/' || sender_user_id::text from public.messages where sender_type = 'system'),
  'outbound/delivered/' || :'uana', 'campos da mensagem de sistema');
select is((select last_message_at from public.conversations where id = '00000000-0000-0000-0000-000000001921'),
  '2026-01-01 10:00:00+00'::timestamptz, 'mensagem de sistema não altera last_message_at');
select tests.authenticate_as(:'uana');
select public.log_conversation_system_message('00000000-0000-0000-0000-000000001921', 'closed');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where sender_type = 'system' and content = 'Conversa fechada por Ana'), 1, 'texto de fechamento');
select tests.authenticate_as(:'uana');
select throws_ok($$select public.log_conversation_system_message('00000000-0000-0000-0000-000000001921', 'hack')$$, '22023', null, 'kind inválido');
select throws_ok(format($$select public.log_conversation_system_message('00000000-0000-0000-0000-000000001921', 'assigned', %L)$$, :'ub'), '22023', null, 'alvo de outra org');
select tests.authenticate_as(:'uview');
select throws_ok($$select public.log_conversation_system_message('00000000-0000-0000-0000-000000001921', 'closed')$$, '42501', null, 'viewer não registra');

-- mark_conversation_read
select public.mark_conversation_read('00000000-0000-0000-0000-000000001921');
select tests.clear_authentication();
select isnt((select last_read_at from public.conversations where id = '00000000-0000-0000-0000-000000001921'), null, 'viewer marca como lida');
select tests.authenticate_as(:'ub');
select throws_ok($$select public.mark_conversation_read('00000000-0000-0000-0000-000000001921')$$, '42501', null, 'outra org não marca');
select tests.clear_authentication();

-- gatilho last_message_at
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content, created_at)
  values (:'org_a', '00000000-0000-0000-0000-000000001921', '00000000-0000-0000-0000-000000001911', 'outbound', 'human', :'uana', 'oi', '2026-02-01 10:00:00+00');
select is((select last_message_at from public.conversations where id = '00000000-0000-0000-0000-000000001921'),
  '2026-02-01 10:00:00+00'::timestamptz, 'mensagem humana atualiza last_message_at');
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content, is_internal_note, created_at)
  values (:'org_a', '00000000-0000-0000-0000-000000001921', '00000000-0000-0000-0000-000000001911', 'outbound', 'human', :'uana', 'nota', true, '2026-03-01 10:00:00+00');
select is((select last_message_at from public.conversations where id = '00000000-0000-0000-0000-000000001921'),
  '2026-02-01 10:00:00+00'::timestamptz, 'nota interna não altera last_message_at');

select * from finish();
rollback;
