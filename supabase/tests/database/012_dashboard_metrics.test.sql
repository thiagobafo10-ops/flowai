begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

select tests.create_user('ua@t.test') as ua \gset
select tests.create_user('uv@t.test') as uv \gset
select tests.create_user('ub@t.test') as ub \gset
select tests.create_user('uc@t.test') as uc \gset
select tests.create_user('ud@t.test') as ud \gset

-- Org A (America/Sao_Paulo), B (America/Manaus) e D (vazia) com pipeline padrão de 7 etapas
select tests.authenticate_as(:'ua');
select public.create_organization_with_owner('Org A') as org \gset
select tests.authenticate_as(:'ub');
select public.create_organization_with_owner('Org B') as orgb \gset
select tests.authenticate_as(:'ud');
select public.create_organization_with_owner('Org D vazia') as orgd \gset
select tests.clear_authentication();
select tests.add_member(:'org', :'uv', 'viewer');
update public.organizations set timezone = 'America/Manaus' where id = :'orgb';
-- Org C sem pipeline padrão
select tests.create_org(:'uc', 'Org C') as orgc \gset

select id as pipe from public.pipelines where organization_id = :'org' and is_default \gset
select id as s_novo from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Novo' \gset
select id as s_int from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Interessado' \gset
select id as s_ganho from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Ganho' \gset
insert into public.channels (organization_id, type, name) values (:'org', 'whatsapp', 'ch') returning id as ch \gset

-- Dados da org A
insert into public.contacts (organization_id, name) values (:'org', 'c1') returning id as c1 \gset
insert into public.contacts (organization_id, name) values (:'org', 'c2') returning id as c2 \gset
insert into public.contacts (organization_id, name) values (:'org', 'c3') returning id as c3 \gset
update public.events set created_at = now() - interval '10 days'
  where organization_id = :'org' and type = 'contact_created' and contact_id = :'c3';

insert into public.conversations (organization_id, contact_id, channel_id) values (:'org', :'c1', :'ch') returning id as cv1 \gset
insert into public.conversations (organization_id, contact_id, channel_id) values (:'org', :'c2', :'ch') returning id as cv2 \gset
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content) values
  (:'org', :'cv1', :'ch', 'inbound', 'contact', 'oi'),
  (:'org', :'cv1', :'ch', 'inbound', 'contact', 'oi 2'),
  (:'org', :'cv1', :'ch', 'outbound', 'ai', 'resposta'),
  (:'org', :'cv2', :'ch', 'inbound', 'contact', 'oi');
update public.conversations set status = 'pending_human' where id = :'cv2';
update public.conversations set status = 'closed' where id = :'cv1';

insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
  values (:'org', :'pipe', :'s_int', :'c1', 'A', 1000);
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
  values (:'org', :'pipe', :'s_novo', :'c2', 'B', 500) returning id as dbid \gset
update public.deals set stage_id = :'s_ganho' where id = :'dbid';

select tests.authenticate_as(:'ua');
select public.dashboard_metrics(:'org', 7)::text as m7 \gset
select public.dashboard_metrics(:'org', 30)::text as m30 \gset
select public.dashboard_metrics(:'org', 1)::text as m1 \gset
select tests.clear_authentication();

select is((:'m7'::jsonb)->'kpis',
  '{"conversations_today":2,"new_contacts":2,"leads":3,"opportunities":1,"potential_value":1000,"ai_handled_conversations":1,"handoffs":1,"resolution_rate":0.5,"conversion_rate":0.5}'::jsonb,
  'kpis 7 dias');
select is((:'m7'::jsonb)->'period_days', '7'::jsonb, 'period_days');
select is((:'m7'::jsonb)->'has_activity', 'true'::jsonb, 'has_activity');
select is(jsonb_array_length((:'m7'::jsonb)->'series'->'conversations_per_day'), 7, '7 pontos em conversations_per_day');
select is(jsonb_array_length((:'m7'::jsonb)->'series'->'ai_vs_handoff_per_day'), 7, '7 pontos em ai_vs_handoff_per_day');
select is((:'m7'::jsonb)->'series'->'conversations_per_day'->6->'count', '2'::jsonb, 'último ponto = hoje com 2 conversas');
select is(((:'m7'::jsonb)->'series'->'ai_vs_handoff_per_day'->6) - 'day',
  '{"ai":1,"handoff":1}'::jsonb, 'último ponto ai 1 handoff 1');
select is((:'m7'::jsonb)->'series'->'conversations_per_day'->6->>'day',
  to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'), 'dia local YYYY-MM-DD');
select is((select sum((p->>'count')::int) from jsonb_array_elements((:'m7'::jsonb)->'series'->'conversations_per_day') p),
  2::bigint, 'dias anteriores zerados');
select is((:'m7'::jsonb)->'series'->'conversations_per_day'->0->>'day',
  to_char(now() at time zone 'America/Sao_Paulo' - interval '6 days', 'YYYY-MM-DD'), 'primeiro dia da janela');
select is((select jsonb_agg(f->>'name' order by (f->>'position')::int) from jsonb_array_elements((:'m7'::jsonb)->'funnel') f),
  '["Novo","Interessado","Qualificado","Orçamento","Negociação","Ganho","Perdido"]'::jsonb, 'funil: 7 etapas em ordem');
select is((select jsonb_agg(jsonb_build_array(f->>'name', f->'count', f->'value') order by (f->>'position')::int)
    from jsonb_array_elements((:'m7'::jsonb)->'funnel') f where (f->>'count')::int > 0),
  '[["Interessado",1,1000],["Ganho",1,500]]'::jsonb, 'funil: contagens e valores');
select is((select count(*)::int from jsonb_array_elements((:'m7'::jsonb)->'funnel') f where f->>'stage_id' is not null), 7, 'funil traz stage_id');

-- p_days = 30 e 1
select is((:'m30'::jsonb)->'kpis'->'new_contacts', '3'::jsonb, '30 dias: new_contacts 3');
select is(jsonb_array_length((:'m30'::jsonb)->'series'->'conversations_per_day'), 30, '30 pontos');
select is((:'m1'::jsonb)->'kpis'->'new_contacts', '2'::jsonb, '1 dia: new_contacts 2');
select is(jsonb_array_length((:'m1'::jsonb)->'series'->'conversations_per_day'), 1, '1 ponto');

-- viewer da org A
select tests.authenticate_as(:'uv');
select lives_ok(format('select public.dashboard_metrics(%L, 7)', :'org'), 'viewer pode chamar');
select public.dashboard_metrics(:'org', 7)::text as mv \gset
select tests.clear_authentication();
select is((:'mv'::jsonb)->'kpis', (:'m7'::jsonb)->'kpis', 'viewer vê os mesmos números');

-- Fuso: evento 1 minuto antes da meia-noite local de hoje não conta
insert into public.contacts (organization_id, name) values (:'org', 'c4') returning id as c4 \gset
insert into public.conversations (organization_id, contact_id, channel_id) values (:'org', :'c4', :'ch') returning id as cv3 \gset
insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, created_at)
  values (:'org', 'message_received', :'cv3', :'c4', 'system',
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '1 minute');
select tests.authenticate_as(:'ua');
select public.dashboard_metrics(:'org', 7)::text as mtz \gset
select tests.clear_authentication();
select is((:'mtz'::jsonb)->'kpis'->'conversations_today', '2'::jsonb, 'virada de dia: evento de 23:59 de ontem não conta hoje');

-- Org B (Manaus): evento às 00:30 locais de hoje conta em hoje
insert into public.contacts (organization_id, name) values (:'orgb', 'b1') returning id as b1 \gset
insert into public.channels (organization_id, type, name) values (:'orgb', 'whatsapp', 'chb') returning id as chb \gset
insert into public.conversations (organization_id, contact_id, channel_id) values (:'orgb', :'b1', :'chb') returning id as cvb \gset
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content)
  values (:'orgb', :'cvb', :'chb', 'inbound', 'contact', 'oi');
update public.events set created_at = least(now(),
    (date_trunc('day', now() at time zone 'America/Manaus') + interval '30 minutes') at time zone 'America/Manaus')
  where organization_id = :'orgb' and type = 'message_received';
select tests.authenticate_as(:'ub');
select public.dashboard_metrics(:'orgb', 7)::text as mb \gset
select is((:'mb'::jsonb)->'kpis'->'conversations_today', '1'::jsonb, 'Manaus: 00:30 local conta em hoje');
-- isolamento / não membro / p_days inválido
select throws_ok(format('select public.dashboard_metrics(%L, 7)', :'org'), '42501', null, 'não membro: 42501');
select throws_ok(format('select public.dashboard_metrics(%L, 3)', :'orgb'), '22023', null, 'p_days inválido: 22023');
select tests.clear_authentication();

-- Org vazia
select tests.authenticate_as(:'ud');
select public.dashboard_metrics(:'orgd', 7)::text as md \gset
select tests.clear_authentication();
select is((:'md'::jsonb)->'has_activity', 'false'::jsonb, 'org vazia: has_activity false');
select is((:'md'::jsonb)->'kpis',
  '{"conversations_today":0,"new_contacts":0,"leads":0,"opportunities":0,"potential_value":0,"ai_handled_conversations":0,"handoffs":0,"resolution_rate":null,"conversion_rate":null}'::jsonb,
  'org vazia: zeros e taxas nulas');
select is(jsonb_array_length((:'md'::jsonb)->'funnel'), 7, 'org vazia: funil com 7 etapas');
select is((select sum((f->>'count')::int) from jsonb_array_elements((:'md'::jsonb)->'funnel') f), 0::bigint, 'org vazia: funil zerado');

-- has_activity via canal ativo (sem eventos)
insert into public.channels (organization_id, type, name, status) values (:'orgd', 'whatsapp', 'ativo', 'active');
select tests.authenticate_as(:'ud');
select public.dashboard_metrics(:'orgd', 7)::text as md2 \gset
select tests.clear_authentication();
select is((:'md2'::jsonb)->'has_activity', 'true'::jsonb, 'canal ativo => has_activity');

-- Org C: sem pipeline padrão; deal aberto em pipeline não padrão
insert into public.pipelines (organization_id, name, is_default) values (:'orgc', 'Outro', false) returning id as pc \gset
insert into public.pipeline_stages (organization_id, pipeline_id, name, position) values (:'orgc', :'pc', 'S0', 0), (:'orgc', :'pc', 'S1', 1);
select id as sc1 from public.pipeline_stages where pipeline_id = :'pc' and position = 1 \gset
insert into public.contacts (organization_id, name) values (:'orgc', 'cc') returning id as cc \gset
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value) values (:'orgc', :'pc', :'sc1', :'cc', 'D', 300);
select tests.authenticate_as(:'uc');
select public.dashboard_metrics(:'orgc', 7)::text as mc \gset
select tests.clear_authentication();
select is((:'mc'::jsonb)->'funnel', '[]'::jsonb, 'sem pipeline padrão: funil []');
select is((:'mc'::jsonb)->'kpis'->'potential_value', '300'::jsonb, 'deal em pipeline não padrão conta em potential_value');
select is((:'mc'::jsonb)->'kpis'->'opportunities', '0'::jsonb, 'mas não em opportunities');

select * from finish();
rollback;
