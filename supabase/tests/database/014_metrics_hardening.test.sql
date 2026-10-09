begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

select tests.create_user('ur@t.test') as ur \gset
select tests.create_user('ub@t.test') as ub \gset
select tests.create_user('us@t.test') as us \gset

select tests.authenticate_as(:'ur');
select public.create_organization_with_owner('Org R') as orgr \gset
select tests.authenticate_as(:'ub');
select public.create_organization_with_owner('Org B') as orgb \gset
select tests.authenticate_as(:'us');
select public.create_organization_with_owner('Org S') as orgs \gset
select tests.clear_authentication();

-- =========================================================== 1. taxas em [0,1]
select id as rpipe from public.pipelines where organization_id = :'orgr' and is_default \gset
select id as r_novo from public.pipeline_stages where pipeline_id = :'rpipe' and name = 'Novo' \gset
select id as r_int from public.pipeline_stages where pipeline_id = :'rpipe' and name = 'Interessado' \gset
select id as r_ganho from public.pipeline_stages where pipeline_id = :'rpipe' and name = 'Ganho' \gset
insert into public.channels (organization_id, type, name) values (:'orgr', 'whatsapp', 'ch') returning id as rch \gset
insert into public.contacts (organization_id, name) values (:'orgr', 'r1') returning id as r1 \gset
insert into public.contacts (organization_id, name) values (:'orgr', 'r2') returning id as r2 \gset
insert into public.contacts (organization_id, name) values (:'orgr', 'r3') returning id as r3 \gset
insert into public.contacts (organization_id, name) values (:'orgr', 'r4') returning id as r4 \gset

-- Conversa com mensagens só ontem (local) e fechada hoje
insert into public.conversations (organization_id, contact_id, channel_id) values (:'orgr', :'r1', :'rch') returning id as cvy \gset
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content)
  values (:'orgr', :'cvy', :'rch', 'inbound', 'contact', 'oi');
update public.events set created_at =
    (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '1 hour'
  where organization_id = :'orgr' and type = 'message_received' and conversation_id = :'cvy';
update public.conversations set status = 'closed' where id = :'cvy';

select tests.authenticate_as(:'ur');
select public.dashboard_metrics(:'orgr', 1)::text as r1a \gset
select tests.clear_authentication();
select is((:'r1a'::jsonb)->'kpis'->'resolution_rate', 'null'::jsonb,
  'p_days=1: conversa sem mensagem hoje (fechada hoje) não entra na taxa de resolução');

-- Outra conversa com mensagem hoje, aberta
insert into public.conversations (organization_id, contact_id, channel_id) values (:'orgr', :'r2', :'rch') returning id as cvt \gset
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content)
  values (:'orgr', :'cvt', :'rch', 'inbound', 'contact', 'oi');
select tests.authenticate_as(:'ur');
select public.dashboard_metrics(:'orgr', 1)::text as r1b \gset
select public.dashboard_metrics(:'orgr', 7)::text as r7b \gset
select tests.clear_authentication();
select is((:'r1b'::jsonb)->'kpis'->'resolution_rate', '0'::jsonb,
  'p_days=1: fechada sem mensagem na janela não conta no numerador');
select is((:'r7b'::jsonb)->'kpis'->'resolution_rate', '0.5'::jsonb,
  'p_days=7: mensagem ontem + fechada hoje conta');

-- Deal Novo -> Ganho -> Novo -> Ganho (um único deal)
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
  values (:'orgr', :'rpipe', :'r_novo', :'r1', 'X', 100) returning id as dx \gset
update public.deals set stage_id = :'r_ganho' where id = :'dx';
update public.deals set stage_id = :'r_novo' where id = :'dx';
update public.deals set stage_id = :'r_ganho' where id = :'dx';
select is((select count(*)::int from public.events where deal_id = :'dx' and type = 'deal_won'), 2, 'cenário: dois deal_won para o mesmo deal');
select tests.authenticate_as(:'ur');
select public.dashboard_metrics(:'orgr', 7)::text as r7c \gset
select tests.clear_authentication();
select is((:'r7c'::jsonb)->'kpis'->'conversion_rate', '1'::jsonb, 'ganho repetido do mesmo deal: conversão 1, não 2');

-- Deal criado há 10 dias e ganho hoje não entra na janela de 7 dias
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
  values (:'orgr', :'rpipe', :'r_novo', :'r2', 'Y', 100) returning id as dy \gset
update public.events set created_at = now() - interval '10 days'
  where deal_id = :'dy' and type = 'deal_created';
update public.deals set stage_id = :'r_ganho' where id = :'dy';
select tests.authenticate_as(:'ur');
select public.dashboard_metrics(:'orgr', 7)::text as r7d \gset
select tests.clear_authentication();
select is((:'r7d'::jsonb)->'kpis'->'conversion_rate', '1'::jsonb, 'deal criado fora da janela e ganho hoje não altera a conversão');

-- Deal novo hoje, aberto
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
  values (:'orgr', :'rpipe', :'r_novo', :'r3', 'Z', 200);
select tests.authenticate_as(:'ur');
select public.dashboard_metrics(:'orgr', 7)::text as r7e \gset
select tests.clear_authentication();
select is((:'r7e'::jsonb)->'kpis'->'conversion_rate', '0.5'::jsonb, 'conversão = ganhos criados na janela / criados na janela');
select is((:'r7e'::jsonb)->'kpis'->'potential_value', '200'::jsonb, 'potential_value antes do deal USD');

-- =========================================================== 5c. moeda: só BRL soma valor
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value, currency)
  values (:'orgr', :'rpipe', :'r_int', :'r4', 'USD', 777, 'USD');
select tests.authenticate_as(:'ur');
select public.dashboard_metrics(:'orgr', 7)::text as r7f \gset
select tests.clear_authentication();
select is((:'r7f'::jsonb)->'kpis'->'potential_value', '200'::jsonb, 'deal USD aberto não altera potential_value');
select is((:'r7f'::jsonb)->'kpis'->'opportunities', '1'::jsonb, 'deal USD conta em opportunities');
select is((select jsonb_build_array(f->'count', f->'value') from jsonb_array_elements((:'r7f'::jsonb)->'funnel') f where f->>'name' = 'Interessado'),
  '[1,0]'::jsonb, 'funil: deal USD conta na contagem mas não no valor');

-- =========================================================== 2. timezone válido
select is((select p.provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'is_valid_timezone'), 'i', 'is_valid_timezone é immutable');
select is((select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'is_valid_timezone'), false, 'is_valid_timezone não é SECURITY DEFINER');
select ok(public.is_valid_timezone('America/Sao_Paulo') and not public.is_valid_timezone('Not/AZone'), 'is_valid_timezone reconhece nomes do catálogo');
select tests.authenticate_as(:'ub');
select throws_ok(format($$update public.organizations set timezone = 'Not/AZone' where id = %L$$, :'orgb'), '23514', null, 'timezone inválido: 23514');
select lives_ok(format($$update public.organizations set timezone = 'America/Manaus' where id = %L$$, :'orgb'), 'timezone America/Manaus aceito');
select tests.clear_authentication();
select is((select timezone from public.organizations where id = :'orgb'), 'America/Manaus', 'timezone gravado');
select throws_ok(format($$update public.organizations set timezone = '' where id = %L$$, :'orgb'), '23514', null, 'timezone vazio: 23514');

-- =========================================================== 4. fuso da org (Manaus)
-- 23:30 de ONTEM em Manaus = 03:30 UTC de hoje = 00:30 de hoje em São Paulo.
-- Com o fuso de São Paulo o evento contaria em "hoje"; com o da org, cai em ontem.
-- (Entre 23:00 e 24:00 de Manaus as datas locais divergem e o caso deixa de discriminar,
-- mas as asserções continuam verdadeiras.)
select ((date_trunc('day', now() at time zone 'America/Manaus') - interval '30 minutes') at time zone 'America/Manaus') as tsb \gset
select ok(:'tsb'::timestamptz <= now(), 'guarda: instante do teste não está no futuro');
insert into public.contacts (organization_id, name) values (:'orgb', 'b1') returning id as b1 \gset
insert into public.channels (organization_id, type, name) values (:'orgb', 'whatsapp', 'chb') returning id as chb \gset
insert into public.conversations (organization_id, contact_id, channel_id) values (:'orgb', :'b1', :'chb') returning id as cvb \gset
insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, created_at)
  values (:'orgb', 'message_received', :'cvb', :'b1', 'system', :'tsb'::timestamptz);
select tests.authenticate_as(:'ub');
select public.dashboard_metrics(:'orgb', 7)::text as mb \gset
select tests.clear_authentication();
select is((:'mb'::jsonb)->'kpis'->'conversations_today', '0'::jsonb, 'Manaus: 23:30 de ontem local não conta hoje');
select is((:'mb'::jsonb)->'series'->'conversations_per_day'->5->'count', '1'::jsonb, 'Manaus: cai no bucket de ontem (índice 5)');
select is((:'mb'::jsonb)->'series'->'conversations_per_day'->5->>'day',
  to_char((now() at time zone 'America/Manaus')::date - 1, 'YYYY-MM-DD'), 'Manaus: bucket 5 é ontem local');
select is((:'mb'::jsonb)->'series'->'conversations_per_day'->6->'count', '0'::jsonb, 'Manaus: bucket de hoje vazio');

-- =========================================================== 3. flags de etapa propagam para deals
select id as spipe from public.pipelines where organization_id = :'orgs' and is_default \gset
select id as s_novo from public.pipeline_stages where pipeline_id = :'spipe' and name = 'Novo' \gset
select id as s_int from public.pipeline_stages where pipeline_id = :'spipe' and name = 'Interessado' \gset
select id as s_ganho from public.pipeline_stages where pipeline_id = :'spipe' and name = 'Ganho' \gset
insert into public.contacts (organization_id, name) values (:'orgs', 's1') returning id as s1 \gset
insert into public.contacts (organization_id, name) values (:'orgs', 's2') returning id as s2 \gset
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
  values (:'orgs', :'spipe', :'s_ganho', :'s1', 'W') returning id as sd1 \gset
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
  values (:'orgs', :'spipe', :'s_int', :'s2', 'I') returning id as sd2 \gset

select tests.authenticate_as(:'us');
update public.pipeline_stages set is_won = false where id = :'s_ganho';
select tests.clear_authentication();
select is((select status::text from public.deals where id = :'sd1'), 'open', 'Ganho deixa de ser is_won => deal volta a open');

update public.pipeline_stages set is_lost = true where id = :'s_int';
select is((select status::text from public.deals where id = :'sd2'), 'lost', 'Interessado vira is_lost => deal lost');
select is((select count(*)::int from public.events where deal_id = :'sd2' and type = 'deal_lost'), 1, 'propagação emite deal_lost');

-- conflito: reabrir deal ganho quando o contato já tem outro aberto
update public.pipeline_stages set is_won = true where id = :'s_ganho';
select is((select status::text from public.deals where id = :'sd1'), 'won', 'Ganho volta a is_won => deal won');
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
  values (:'orgs', :'spipe', :'s_novo', :'s1', 'O');
select throws_ok(format($$update public.pipeline_stages set is_won = false where id = %L$$, :'s_ganho'), '23505', null,
  'reabrir por flag com outro deal aberto: 23505');
select is((select is_won from public.pipeline_stages where id = :'s_ganho'), true, 'flag não muda quando a propagação falha');

-- =========================================================== 5b. eventos de conversa criada já em pending_human/closed
insert into public.channels (organization_id, type, name) values (:'orgs', 'whatsapp', 'chs') returning id as chs \gset
insert into public.conversations (organization_id, contact_id, channel_id, status)
  values (:'orgs', :'s1', :'chs', 'pending_human') returning id as cvp \gset
select is((select jsonb_agg(jsonb_build_array(type, payload) order by type) from public.events
    where conversation_id = :'cvp' and type in ('handoff', 'conversation_closed')),
  '[["handoff",{"from_status":null}]]'::jsonb, 'insert em pending_human emite handoff {from_status: null}');
insert into public.conversations (organization_id, contact_id, channel_id, status)
  values (:'orgs', :'s2', :'chs', 'closed') returning id as cvc \gset
select is((select jsonb_agg(jsonb_build_array(type, payload) order by type) from public.events
    where conversation_id = :'cvc' and type in ('handoff', 'conversation_closed')),
  '[["conversation_closed",{"from_status":null}]]'::jsonb, 'insert em closed emite conversation_closed {from_status: null}');
select is((select count(*)::int from public.events where conversation_id in (:'cvp', :'cvc') and type = 'conversation_created'),
  2, 'conversation_created continua emitido');

select * from finish();
rollback;
