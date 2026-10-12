begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select tests.create_user('a21@t.test', 'Dona') as ua \gset
select tests.create_user('b21@t.test', 'Outro') as ub \gset
select tests.create_user('ana21@t.test', 'Ana') as uana \gset
select tests.create_org(:'ua', 'Org A21') as org_a \gset
select tests.create_org(:'ub', 'Org B21') as org_b \gset
select tests.add_member(:'org_a', :'uana', 'agent');

insert into public.channels (id, organization_id, type, name, status) values
  ('00000000-0000-0000-0000-000000002111', :'org_a', 'simulator', 'Sim', 'active');
insert into public.contacts (id, organization_id, name, phone) values
  ('00000000-0000-0000-0000-000000002101', :'org_a', 'José Álvares', '+5511911112222'),
  ('00000000-0000-0000-0000-000000002102', :'org_a', 'Maria', '+5511933334444'),
  ('00000000-0000-0000-0000-000000002103', :'org_a', 'Pedro', '+5511955556666'),
  ('00000000-0000-0000-0000-000000002104', :'org_a', 'Lia', '+5511977778888');
-- c1, c2, c3 empatam em last_message_at; c4 fechada
insert into public.conversations (id, organization_id, contact_id, channel_id, status, assigned_to, last_message_at) values
  ('00000000-0000-0000-0000-000000002121', :'org_a', '00000000-0000-0000-0000-000000002101', '00000000-0000-0000-0000-000000002111', 'open', null, '2026-01-02 10:00:00+00'),
  ('00000000-0000-0000-0000-000000002122', :'org_a', '00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002111', 'pending_human', :'uana', '2026-01-02 10:00:00+00'),
  ('00000000-0000-0000-0000-000000002123', :'org_a', '00000000-0000-0000-0000-000000002103', '00000000-0000-0000-0000-000000002111', 'open', :'uana', '2026-01-02 10:00:00+00'),
  ('00000000-0000-0000-0000-000000002124', :'org_a', '00000000-0000-0000-0000-000000002104', '00000000-0000-0000-0000-000000002111', 'closed', null, '2026-01-01 10:00:00+00');
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, created_at) values
  (:'org_a', '00000000-0000-0000-0000-000000002121', '00000000-0000-0000-0000-000000002111', 'inbound', 'contact', 'Quero 100% de desconto', '2026-01-02 09:00:00+00'),
  (:'org_a', '00000000-0000-0000-0000-000000002122', '00000000-0000-0000-0000-000000002111', 'inbound', 'contact', 'Preciso de ajuda', '2026-01-02 09:00:00+00'),
  (:'org_a', '00000000-0000-0000-0000-000000002123', '00000000-0000-0000-0000-000000002111', 'inbound', 'contact', 'Oi', '2026-01-02 09:00:00+00'),
  (:'org_a', '00000000-0000-0000-0000-000000002124', '00000000-0000-0000-0000-000000002111', 'inbound', 'contact', 'Fechado', '2026-01-01 09:00:00+00');
-- notas e sistema não entram na prévia
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, is_internal_note, created_at) values
  (:'org_a', '00000000-0000-0000-0000-000000002123', '00000000-0000-0000-0000-000000002111', 'outbound', 'human', 'nota secreta', true, '2026-01-02 09:30:00+00'),
  (:'org_a', '00000000-0000-0000-0000-000000002123', '00000000-0000-0000-0000-000000002111', 'outbound', 'system', 'Ana assumiu', false, '2026-01-02 09:40:00+00');

select tests.authenticate_as(:'uana');

select is((select count(*)::int from public.list_inbox(:'org_a', 'todas', null, null, null, null, 50)), 3, 'todas: não fechadas');
select is((select count(*)::int from public.list_inbox(:'org_a', 'minhas', null, null, null, null, 50)), 2, 'minhas: atribuídas a mim');
select is((select count(*)::int from public.list_inbox(:'org_a', 'nao-atribuidas', null, null, null, null, 50)), 1, 'não atribuídas: abertas sem responsável');
select is((select count(*)::int from public.list_inbox(:'org_a', 'aguardando', null, null, null, null, 50)), 1, 'aguardando humano');
select is((select count(*)::int from public.list_inbox(:'org_a', 'fechadas', null, null, null, null, 50)), 1, 'fechadas');
select is((select public.inbox_counts(:'org_a')), '{"minhas":2,"nao-atribuidas":1,"aguardando":1,"todas":3,"fechadas":0}'::jsonb, 'contadores');

select is((select preview from public.list_inbox(:'org_a', 'todas', null, null, null, null, 50) where id = '00000000-0000-0000-0000-000000002123'),
  'Oi', 'prévia ignora nota e sistema');

-- empates em last_message_at não são pulados entre páginas
create temp table pg1 as select * from public.list_inbox(:'org_a', 'todas', null, null, null, null, 2);
create temp table pg2 as select * from public.list_inbox(:'org_a', 'todas', null, null,
  (select last_message_at from pg1 order by last_message_at desc, id desc offset 1 limit 1),
  (select id from pg1 order by last_message_at desc, id desc offset 1 limit 1), 2);
select is((select count(*)::int from pg1) + (select count(*)::int from pg2), 3, 'duas páginas cobrem as 3 conversas');
select is((select count(distinct id)::int from (select id from pg1 union all select id from pg2) s), 3, 'sem repetição entre páginas');

-- busca
select is((select count(*)::int from public.list_inbox(:'org_a', 'todas', 'jose alvares', null, null, null, 50)), 1, 'busca por nome sem acento');
select is((select count(*)::int from public.list_inbox(:'org_a', 'todas', '(11) 93333-4444', null, null, null, 50)), 1, 'busca por dígitos do telefone');
select is((select count(*)::int from public.list_inbox(:'org_a', 'todas', 'ajuda', null, null, null, 50)), 1, 'busca por texto da prévia');
select is((select count(*)::int from public.list_inbox(:'org_a', 'todas', '%', null, null, null, 50)), 1, '% literal não é curinga');
select is((select count(*)::int from public.list_inbox(:'org_a', 'todas', 'nota secreta', null, null, null, 50)), 0, 'nota interna não é pesquisável');

-- nota interna sem status, depois status delivered
select lives_ok(format($$
  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content, content_type, is_internal_note)
  values (%L, '00000000-0000-0000-0000-000000002123', '00000000-0000-0000-0000-000000002111', 'outbound', 'human', %L, 'nota', 'text', true)$$, :'org_a', :'uana'),
  'agent insere nota sem status');
select lives_ok($$update public.messages set status = 'delivered' where conversation_id = '00000000-0000-0000-0000-000000002123' and content = 'nota' and is_internal_note$$,
  'agent atualiza a nota para delivered');

select tests.clear_authentication();
select tests.authenticate_as(:'ub');
select throws_ok(format($$select * from public.list_inbox(%L, 'todas', null, null, null, null, 50)$$, :'org_a'), '42501', null, 'outra org: 42501');

select throws_ok(format($$select public.inbox_counts(%L)$$, :'org_a'), '42501', null, 'contadores de outra org: 42501');

select * from finish();
rollback;
