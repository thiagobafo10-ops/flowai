begin;
create extension if not exists pgtap with schema extensions;
select plan(36);
select tests.create_user('owner36a@t.test','Owner A') as ua \gset
select tests.create_user('owner36b@t.test','Owner B') as ub \gset
select tests.create_org(:'ua','Org36A') as oa \gset
select tests.create_org(:'ub','Org36B') as ob \gset
insert into public.channels(id,organization_id,type,name) values ('00000000-0000-0000-0000-000000003601',:'oa','whatsapp','WA36');
insert into public.contacts(id,organization_id,name) values ('00000000-0000-0000-0000-000000003611',:'oa','C36');
insert into public.conversations(id,organization_id,contact_id,channel_id) values
  ('00000000-0000-0000-0000-000000003621',:'oa','00000000-0000-0000-0000-000000003611','00000000-0000-0000-0000-000000003601'),
  ('00000000-0000-0000-0000-000000003622',:'oa','00000000-0000-0000-0000-000000003611','00000000-0000-0000-0000-000000003601'),
  ('00000000-0000-0000-0000-000000003623',:'oa','00000000-0000-0000-0000-000000003611','00000000-0000-0000-0000-000000003601');

-- estrutura e RLS
select has_table('public','ai_jobs','ai_jobs existe');
select has_table('public','ai_usage_daily','ai_usage_daily existe');
select ok((select relrowsecurity from pg_class where oid='public.ai_jobs'::regclass),'RLS em ai_jobs');
select ok((select relrowsecurity from pg_class where oid='public.ai_usage_daily'::regclass),'RLS em ai_usage_daily');
select ok(not has_table_privilege('authenticated','public.ai_jobs','select'),'authenticated não lê ai_jobs');
select ok(not has_function_privilege('authenticated','public.claim_ai_jobs(integer)','execute'),'authenticated não executa claim_ai_jobs');
select ok(not has_function_privilege('authenticated','public.consume_ai_quota(uuid,text)','execute'),'authenticated não executa consume_ai_quota');
select ok(not has_function_privilege('authenticated','public.fail_ai_job(uuid,uuid,text,boolean)','execute'),'authenticated não executa fail_ai_job');
select ok(has_function_privilege('authenticated','public.ai_quota(uuid)','execute'),'authenticated executa ai_quota');

-- uso diário: membro lê só a própria organização
insert into public.ai_usage_daily(organization_id,day,replies,tests) values (:'oa',(now() at time zone 'America/Sao_Paulo')::date,5,1),(:'ob',current_date,7,2);
select tests.authenticate_as(:'ua');
select is((select count(*)::int from public.ai_usage_daily),1,'membro vê só o uso da própria org');
select is((select replies from public.ai_usage_daily),5,'uso correto');
select is(public.ai_quota(:'oa')->>'repliesLimit','300','ai_quota devolve o limite padrão');
select is(public.ai_quota(:'oa')->>'replies','5','ai_quota devolve o consumo');
select throws_ok(format($$select public.ai_quota(%L)$$,:'ob'),'42501',null,'ai_quota de outra org é negada');
select throws_ok(format($$insert into public.ai_usage_daily(organization_id,day) values (%L,current_date+1)$$,:'oa'),'42501',null,'membro não escreve uso');
select tests.clear_authentication();

-- cota: 300 respostas, 301ª falha; override por org; dia no fuso da org
delete from public.ai_usage_daily;
update public.organizations set timezone='Pacific/Kiritimati' where id=:'oa';
select public.consume_ai_quota(:'oa','reply');
select is((select day from public.ai_usage_daily where organization_id=:'oa'),
  (now() at time zone 'Pacific/Kiritimati')::date,'dia segue o fuso da organização');
update public.ai_usage_daily set replies=299 where organization_id=:'oa';
select is(public.consume_ai_quota(:'oa','reply'),true,'300ª resposta passa');
select is(public.consume_ai_quota(:'oa','reply'),false,'301ª resposta é negada');
select is((select replies from public.ai_usage_daily where organization_id=:'oa'),300,'contador não passa do limite');
insert into private.ai_limit_overrides(organization_id,daily_replies,daily_tests) values (:'oa',301,1);
select is(public.consume_ai_quota(:'oa','reply'),true,'override maior libera');
select is(public.consume_ai_quota(:'oa','test'),true,'1º teste passa');
select is(public.consume_ai_quota(:'oa','test'),false,'2º teste é negado pelo override');

-- fila
insert into public.ai_jobs(id,organization_id,kind,conversation_id,run_after) values
  ('00000000-0000-0000-0000-000000003631',:'oa','reply','00000000-0000-0000-0000-000000003621',now()+interval '1 hour'),
  ('00000000-0000-0000-0000-000000003632',:'oa','reply','00000000-0000-0000-0000-000000003622',now()-interval '1 minute'),
  ('00000000-0000-0000-0000-000000003633',:'oa','reply','00000000-0000-0000-0000-000000003623',now()-interval '1 minute');
select public.claim_ai_jobs(1) as c1 \gset
select is(jsonb_array_length(:'c1'::jsonb),1,'primeira reserva pega 1');
select public.claim_ai_jobs(5) as c2 \gset
select is(jsonb_array_length(:'c2'::jsonb),1,'segunda reserva pega só o restante vencido');
select isnt(:'c1'::jsonb->0->>'jobId',:'c2'::jsonb->0->>'jobId','reservas não repetem o job');
select is((select state from public.ai_jobs where id='00000000-0000-0000-0000-000000003631'),'pending','job futuro não é reservado');
select is((select attempts from public.ai_jobs where id=(:'c1'::jsonb->0->>'jobId')::uuid),1,'reserva soma tentativa');

-- falha: token errado não altera; backoff e esgotamento
select (:'c1'::jsonb->0->>'jobId')::uuid as j1, (:'c1'::jsonb->0->>'claimToken')::uuid as t1 \gset
select public.fail_ai_job(:'j1',gen_random_uuid(),'boom',true);
select is((select state from public.ai_jobs where id=:'j1'),'running','token errado não altera');
select public.fail_ai_job(:'j1',:'t1','boom',true);
select is((select run_after - now() between interval '9 seconds' and interval '11 seconds' from public.ai_jobs where id=:'j1'),true,'backoff 10s na 1ª falha');
update public.ai_jobs set run_after=now() where id=:'j1';
select public.claim_ai_jobs(5) as c3 \gset
select public.fail_ai_job(:'j1',(select claim_token from public.ai_jobs where id=:'j1'),'boom',true);
select is((select run_after - now() between interval '29 seconds' and interval '31 seconds' from public.ai_jobs where id=:'j1'),true,'backoff 30s na 2ª falha');
update public.ai_jobs set run_after=now() where id=:'j1';
select public.claim_ai_jobs(5) as c4 \gset
select public.fail_ai_job(:'j1',(select claim_token from public.ai_jobs where id=:'j1'),'boom',true);
select is((select state from public.ai_jobs where id=:'j1'),'failed','3ª falha encerra como failed');

-- sweep devolve reserva expirada
select (:'c2'::jsonb->0->>'jobId')::uuid as j2 \gset
update public.ai_jobs set claimed_until=now()-interval '1 second' where id=:'j2';
select public.sweep_ai_jobs();
select is((select state||':'||last_error from public.ai_jobs where id=:'j2'),'pending:claim_expired','sweep devolve reserva expirada');

-- dispatch sem config não falha; com config chama só se houver trabalho vencido; cron existe
select lives_ok($$select public.dispatch_ai_worker()$$,'dispatch sem config não falha');
select public.configure_ai_worker('http://kong:8000', repeat('k',40), repeat('w',40));
delete from public.ai_jobs;
select count(*)::int as before_http from net.http_request_queue \gset
select public.dispatch_ai_worker();
select is((select count(*)::int from net.http_request_queue), :before_http, 'sem tarefa vencida não chama o worker');
insert into public.ai_jobs(organization_id,kind,conversation_id,run_after) values (:'oa','reply','00000000-0000-0000-0000-000000003621',now()-interval '1 second');
select public.dispatch_ai_worker();
select is((select count(*)::int from net.http_request_queue), :before_http + 1, 'tarefa vencida chama o worker');
select is((select schedule from cron.job where jobname='flowai-ai-worker'),'5 seconds','cron do worker de IA agendado');
select * from finish();
rollback;
