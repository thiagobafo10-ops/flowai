begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

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

-- ingere como postgres (tempo controlado)
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
select is(public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-1', '+5511999990001', 'Maria', 'Olá!', '2026-03-01 12:00:00+00'), :'m1'::uuid, 'duplicada retorna mesmo id');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where organization_id = :'org_a'), 1, 'continua 1 mensagem');
select is((select count(*)::int from public.events where organization_id = :'org_a' and type = 'message_received'), 1, 'continua 1 evento');

-- segunda mensagem do mesmo telefone
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-2', '+5511999990001', 'Maria', 'Tudo bem?', '2026-03-01 12:05:00+00') as m2 \gset
select tests.clear_authentication();
select is((select count(distinct contact_id)::int from public.conversations where organization_id = :'org_a'), 1, 'mesmo contato');
select is((select count(*)::int from public.conversations where organization_id = :'org_a'), 1, 'mesma conversa');
select is((select count(*)::int from public.messages where organization_id = :'org_a'), 2, 'duas mensagens');
select is((select last_interaction_at from public.contacts where phone = '+5511999990001'), '2026-03-01 12:05:00+00'::timestamptz, 'last_interaction_at avança');

-- mensagem antiga não regride last_interaction_at
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-old', '+5511999990001', 'Maria', 'Antiga', '2026-03-01 11:00:00+00');
select tests.clear_authentication();
select is((select last_interaction_at from public.contacts where phone = '+5511999990001'), '2026-03-01 12:05:00+00'::timestamptz, 'last_interaction_at só avança');

-- fechada com responsável: reabre
update public.conversations set assigned_to = :'uag', status = 'closed' where organization_id = :'org_a';
select isnt((select closed_at from public.conversations where organization_id = :'org_a'), null, 'fechada tem closed_at');
-- duplicada após fechar NÃO reabre
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-2', '+5511999990001', 'Maria', 'Tudo bem?', '2026-03-01 12:05:00+00');
select tests.clear_authentication();
select is((select status::text from public.conversations where organization_id = :'org_a'), 'closed', 'duplicada não reabre');
select is((select assigned_to from public.conversations where organization_id = :'org_a'), :'uag'::uuid, 'duplicada não limpa responsável');
-- nova reabre
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ext-3', '+5511999990001', 'Maria', 'Voltei', '2026-03-01 13:00:00+00');
select tests.clear_authentication();
select is((select status::text from public.conversations where organization_id = :'org_a'), 'open', 'nova mensagem reabre');
select is((select assigned_to from public.conversations where organization_id = :'org_a'), null, 'reabrir limpa responsável');
select is((select closed_at from public.conversations where organization_id = :'org_a'), null, 'reabrir limpa closed_at');

-- agente ativo com auto_reply => nova conversa ai
insert into public.ai_agents (organization_id, name, is_active, auto_reply) values (:'org_a', 'Bot A', true, true);
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
select throws_ok($$select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'x4b', '+5511999990003', 'Z', E' 
 ', now())$$, '22023', null, 'texto so espacos => 22023');
select throws_ok(format($$select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'x5', '+5511999990003', 'Z', %L, now())$$, repeat('a', 4097)), '22023', null, 'texto > 4096 => 22023');
select tests.authenticate_as(:'ub');
select throws_ok($$select public.ingest_inbound_message('00000000-0000-0000-0000-000000002013', 'x6', '+5511999990003', 'Z', 'oi', now())$$, 'P0002', null, 'canal needs_setup => P0002');
select throws_ok($$select public.ingest_inbound_message('00000000-0000-0000-0000-0000000020ff', 'x7', '+5511999990003', 'Z', 'oi', now())$$, 'P0002', null, 'canal inexistente => P0002');
select tests.clear_authentication();
select is((select count(*)::int from public.contacts where phone = '+5511999990003'), 0, 'rejeicoes nao criam contato');

-- admin simulador: p_sent_at ignorado, usa now()
select tests.authenticate_as(:'ua');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'adm-1', '+5511999990010', 'Ana', 'Oi', now() + interval '10 years') as madm \gset
select tests.clear_authentication();
select is((select created_at from public.messages where id = :'madm'), now(), 'admin: created_at = now() ignorando p_sent_at');
select is((select last_interaction_at from public.contacts where phone = '+5511999990010'), now(), 'admin: last_interaction_at = now()');
select is((select source::text from public.contacts where phone = '+5511999990010'), 'simulator', 'admin cria contato simulator');

-- postgres: futuro limitado a now()
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'fut-1', '+5511999990011', 'Fut', 'Oi', now() + interval '10 years') as mfut \gset
select ok((select created_at from public.messages where id = :'mfut') <= now(), 'postgres: futuro limitado a now()');

-- service_role em canal whatsapp
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002012', 'sr-1', '+5511999990020', 'Zap', 'Oi', now() + interval '10 years') as msr \gset
reset role;
select set_config('request.jwt.claims', '', true);
select isnt(:'msr'::uuid, null, 'service_role ingere em canal whatsapp');
select ok((select created_at from public.messages where id = :'msr') <= now(), 'service_role: futuro limitado a now()');
select is((select whatsapp_id from public.contacts where phone = '+5511999990020'), '+5511999990020', 'whatsapp: whatsapp_id preenchido');
select is((select source::text from public.contacts where phone = '+5511999990020'), 'whatsapp', 'whatsapp: source');

-- whatsapp: contato existente so com phone ganha whatsapp_id
insert into public.contacts (organization_id, name, phone) values (:'org_a', 'Manual', '+5511999990030');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002012', 'bf-1', '+5511999990030', 'Manual', 'Oi', '2026-04-01 10:00:00+00');
select is((select count(*)::int from public.contacts where organization_id = :'org_a' and phone = '+5511999990030'), 1, 'whatsapp: casou por phone sem duplicar');
select is((select whatsapp_id from public.contacts where phone = '+5511999990030'), '+5511999990030', 'whatsapp: backfill de whatsapp_id');

-- JWT sem role, role authenticated => 42501
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001"}', true);
set local role authenticated;
select throws_ok($$select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'nr-1', '+5511999990040', 'Z', 'oi', now())$$, '42501', null, 'claims sem role => 42501');
reset role;
select set_config('request.jwt.claims', '', true);

-- reabrir com agente ativo auto_reply => ai
update public.conversations set status = 'closed', handled_by = 'human' where contact_id = (select id from public.contacts where phone = '+5511999990002');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'rop-1', '+5511999990002', 'Joao', 'Voltei', '2026-03-03 09:00:00+00');
select is((select c.handled_by::text from public.conversations c join public.contacts k on k.id = c.contact_id where k.phone = '+5511999990002'), 'ai', 'reabrir com auto_reply => ai');

-- pending_human permanece
update public.conversations set status = 'pending_human' where contact_id = (select id from public.contacts where phone = '+5511999990002');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'ph-1', '+5511999990002', 'Joao', 'Ajuda', '2026-03-03 10:00:00+00');
select is((select c.status::text from public.conversations c join public.contacts k on k.id = c.contact_id where k.phone = '+5511999990002'), 'pending_human', 'pending_human permanece');

-- mensagem mais antiga nao move last_message_at para tras
select public.ingest_inbound_message('00000000-0000-0000-0000-000000002011', 'old-2', '+5511999990002', 'Joao', 'Velha', '2026-03-02 00:00:00+00');
select is((select c.last_message_at from public.conversations c join public.contacts k on k.id = c.contact_id where k.phone = '+5511999990002'), '2026-03-03 10:00:00+00'::timestamptz, 'last_message_at nao regride');

select * from finish();
rollback;
