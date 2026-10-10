begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

select tests.create_user('a20@t.test', 'Dona') as ua \gset
select tests.create_user('b20@t.test', 'Outro') as ub \gset
select tests.create_user('ag20@t.test', 'Agente') as uag \gset
select tests.create_org(:'ua', 'Org A20') as org_a \gset
select tests.create_org(:'ub', 'Org B20') as org_b \gset
select tests.add_member(:'org_a', :'uag', 'agent');

insert into public.channels (id, organization_id, type, name, status) values
  ('00000000-0000-0000-0000-000000002011', :'org_a', 'simulator', 'Sim A', 'active'),
  ('00000000-0000-0000-0000-000000002012', :'org_a', 'whatsapp', 'WA A', 'active'),
  ('00000000-0000-0000-0000-000000002013', :'org_b', 'simulator', 'Sim B', 'needs_setup');

-- admin ingere
select tests.authenticate_as(:'ua');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-1', '+5511999990001', 'Maria', 'Olá!', '2026-03-01 12:00:00+00') as m1 \gset
select tests.clear_authentication();
select isnt(:'m1'::uuid, null, 'retorna id da mensagem');
select is((select count(*)::int from public.contacts where organization_id = :'org_a' and phone = '+5511999990001'), 1, 'contato criado');
select is((select source::text from public.contacts where phone = '+5511999990001'), 'simulator', 'source simulator');
select is((select name from public.contacts where phone = '+5511999990001'), 'Maria', 'nome do contato');
select is((select count(*)::int from public.conversations where organization_id = :'org_a'), 1, 'uma conversa');
select is((select status::text from public.conversations where organization_id = :'org_a'), 'open', 'conversa open');
select is((select handled_by::text from public.conversations where organization_id = :'org_a'), 'human', 'handled_by human (agente inativo)');
select is((select assigned_to from public.conversations where organization_id = :'org_a'), null, 'sem responsável');
select is((select direction::text || '/' || sender_type::text || '/' || status::text from public.messages where id = :'m1'), 'inbound/contact/delivered', 'mensagem inbound/contact/delivered');
select is((select content from public.messages where id = :'m1'), 'Olá!', 'conteúdo');
select is((select created_at from public.messages where id = :'m1'), '2026-03-01 12:00:00+00'::timestamptz, 'created_at = sent_at');
select is((select last_message_at from public.conversations where organization_id = :'org_a'), '2026-03-01 12:00:00+00'::timestamptz, 'last_message_at = sent_at');
select is((select last_interaction_at from public.contacts where phone = '+5511999990001'), '2026-03-01 12:00:00+00'::timestamptz, 'last_interaction_at = sent_at');
select is((select count(*)::int from public.events where organization_id = :'org_a' and type = 'message_received'), 1, 'message_received emitido');

-- duplicada: mesmo id, sem efeitos
select tests.authenticate_as(:'ua');
select is(public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-1', '+5511999990001', 'Maria', 'Olá!', '2026-03-01 12:00:00+00'), :'m1'::uuid, 'duplicada retorna mesmo id');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where organization_id = :'org_a'), 1, 'continua 1 mensagem');
select is((select count(*)::int from public.events where organization_id = :'org_a' and type = 'message_received'), 1, 'continua 1 evento');

-- segunda mensagem do mesmo telefone
select tests.authenticate_as(:'ua');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-2', '+5511999990001', 'Maria', 'Tudo bem?', '2026-03-01 12:05:00+00') as m2 \gset
select tests.clear_authentication();
select is((select count(distinct contact_id)::int from public.conversations where organization_id = :'org_a'), 1, 'mesmo contato');
select is((select count(*)::int from public.conversations where organization_id = :'org_a'), 1, 'mesma conversa');
select is((select count(*)::int from public.messages where organization_id = :'org_a'), 2, 'duas mensagens');
select is((select last_interaction_at from public.contacts where phone = '+5511999990001'), '2026-03-01 12:05:00+00'::timestamptz, 'last_interaction_at avança');

-- mensagem antiga não regride last_interaction_at
select tests.authenticate_as(:'ua');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-old', '+5511999990001', 'Maria', 'Antiga', '2026-03-01 11:00:00+00');
select tests.clear_authentication();
select is((select last_interaction_at from public.contacts where phone = '+5511999990001'), '2026-03-01 12:05:00+00'::timestamptz, 'last_interaction_at só avança');

-- fechada com responsável: reabre
update public.conversations set assigned_to = :'uag', status = 'closed' where organization_id = :'org_a';
select isnt((select closed_at from public.conversations where organization_id = :'org_a'), null, 'fechada tem closed_at');
-- duplicada após fechar NÃO reabre
select tests.authenticate_as(:'ua');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-2', '+5511999990001', 'Maria', 'Tudo bem?', '2026-03-01 12:05:00+00');
select tests.clear_authentication();
select is((select status::text from public.conversations where organization_id = :'org_a'), 'closed', 'duplicada não reabre');
select is((select assigned_to from public.conversations where organization_id = :'org_a'), :'uag'::uuid, 'duplicada não limpa responsável');
-- nova reabre
select tests.authenticate_as(:'ua');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-3', '+5511999990001', 'Maria', 'Voltei', '2026-03-01 13:00:00+00');
select tests.clear_authentication();
select is((select status::text from public.conversations where organization_id = :'org_a'), 'open', 'nova mensagem reabre');
select is((select assigned_to from public.conversations where organization_id = :'org_a'), null, 'reabrir limpa responsável');
select is((select closed_at from public.conversations where organization_id = :'org_a'), null, 'reabrir limpa closed_at');

-- agente ativo com auto_reply => nova conversa ai
insert into public.ai_agents (organization_id, name, is_active, auto_reply) values (:'org_a', 'Bot A', true, true);
select tests.authenticate_as(:'ua');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-4', '+5511999990002', 'Joao', 'Oi', '2026-03-02 09:00:00+00');
select tests.clear_authentication();
select is((select c.handled_by::text from public.conversations c join public.contacts k on k.id = c.contact_id where k.phone = '+5511999990002'), 'ai', 'agente ativo com auto_reply => ai');

-- autorizacao e validacao
select tests.authenticate_as(:'uag');
select throws_ok($$select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'x1', '+5511999990003', 'Z', 'oi', now())$$, '42501', null, 'agent nao ingere');
select tests.authenticate_as(:'ua');
select throws_ok($$select public.ingest_inbound_message('00000000-0000-0000-0000-000000002012', 'x2', '+5511999990003', 'Z', 'oi', now())$$, '42501', null, 'admin em canal whatsapp => 42501');
select tests.authenticate_as(:'ub');
select throws_ok($$select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'x3', '+5511999990003', 'Z', 'oi', now())$$, '42501', null, 'admin de outra org => 42501');
select tests.authenticate_as(:'ua');
select throws_ok($$select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'x4', '+5511999990003', 'Z', '', now())$$, '22023', null, 'texto vazio => 22023');
select throws_ok(format($$select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'x5', '+5511999990003', 'Z', %L, now())$$, repeat('a', 4097)), '22023', null, 'texto > 4096 => 22023');
select tests.authenticate_as(:'ub');
select throws_ok($$select public.ingest_inbound_message('00000000-0000-0000-0000-000000002013', 'x6', '+5511999990003', 'Z', 'oi', now())$$, 'P0002', null, 'canal needs_setup => P0002');
select throws_ok($$select public.ingest_inbound_message('00000000-0000-0000-0000-0000000020ff', 'x7', '+5511999990003', 'Z', 'oi', now())$$, 'P0002', null, 'canal inexistente => P0002');
select tests.clear_authentication();
select is((select count(*)::int from public.contacts where phone = '+5511999990003'), 0, 'rejeicoes nao criam contato');

select * from finish();
rollback;
