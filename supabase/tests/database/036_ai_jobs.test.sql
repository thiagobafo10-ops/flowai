begin;
create extension if not exists pgtap with schema extensions;
select plan(67);
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
select ok(not has_function_privilege('anon','public.ai_quota(uuid)','execute'),'anon não executa ai_quota');
select ok(not has_function_privilege('authenticated','public.configure_ai_worker(text,text,text)','execute'),'authenticated não executa configure_ai_worker');
select ok(not has_function_privilege('anon','public.configure_ai_worker(text,text,text)','execute'),'anon não executa configure_ai_worker');
select ok(not has_function_privilege('authenticated','public.read_ai_worker_config()','execute'),'authenticated não executa read_ai_worker_config');
select ok(not has_function_privilege('anon','public.read_ai_worker_config()','execute'),'anon não executa read_ai_worker_config');
select ok(not has_function_privilege('authenticated','public.sweep_ai_jobs()','execute'),'authenticated não executa sweep_ai_jobs');
select ok(not has_function_privilege('anon','public.sweep_ai_jobs()','execute'),'anon não executa sweep_ai_jobs');
select ok(not has_function_privilege('authenticated','public.dispatch_ai_worker()','execute'),'authenticated não executa dispatch_ai_worker');
select ok(not has_function_privilege('anon','public.dispatch_ai_worker()','execute'),'anon não executa dispatch_ai_worker');
select is((select daily_tests from private.ai_settings),30,'limite padrão de testes é 30');

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
update public.organizations set timezone='Pacific/Pago_Pago' where id=:'ob';
select public.consume_ai_quota(:'ob','reply');
select isnt((select day from public.ai_usage_daily where organization_id=:'ob'),(select day from public.ai_usage_daily where organization_id=:'oa'),'fusos distantes dão dias diferentes');
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
select ok((select url like '%/functions/v1/ai-worker' and headers ? 'X-FlowAI-Worker' from net.http_request_queue order by id desc limit 1),'requisição vai para o ai-worker com o header do worker');
select is((select schedule from cron.job where jobname='flowai-ai-worker'),'5 seconds','cron do worker de IA agendado');

-- retry não pode colidir com outra tarefa pendente do mesmo alvo
delete from public.ai_jobs;
insert into public.knowledge_documents(id,organization_id,title,content) values ('00000000-0000-0000-0000-000000003641',:'oa','Doc','x');
insert into public.ai_jobs(id,organization_id,kind,conversation_id,state,attempts,claim_token,claimed_until) values
  ('00000000-0000-0000-0000-000000003651',:'oa','reply','00000000-0000-0000-0000-000000003622','running',1,gen_random_uuid(),now()-interval '1 second');
insert into public.ai_jobs(id,organization_id,kind,conversation_id,run_after) values
  ('00000000-0000-0000-0000-000000003652',:'oa','reply','00000000-0000-0000-0000-000000003622',now()+interval '1 hour');
insert into public.ai_jobs(id,organization_id,kind,document_id,document_generation,state,attempts,claim_token,claimed_until) values
  ('00000000-0000-0000-0000-000000003653',:'oa','index_document','00000000-0000-0000-0000-000000003641',1,'running',1,gen_random_uuid(),now()-interval '1 second');
insert into public.ai_jobs(id,organization_id,kind,document_id,document_generation,run_after) values
  ('00000000-0000-0000-0000-000000003654',:'oa','index_document','00000000-0000-0000-0000-000000003641',2,now()+interval '1 hour');
select lives_ok($$select public.sweep_ai_jobs()$$,'sweep não falha com tarefa pendente do mesmo alvo');
select is((select state||':'||last_error from public.ai_jobs where id='00000000-0000-0000-0000-000000003651'),'cancelled:claim_expired','reply substituída é cancelada');
select is((select state from public.ai_jobs where id='00000000-0000-0000-0000-000000003652'),'pending','reply pendente intacta');
select is((select state||':'||last_error from public.ai_jobs where id='00000000-0000-0000-0000-000000003653'),'cancelled:claim_expired','indexação substituída é cancelada');
select is((select state from public.ai_jobs where id='00000000-0000-0000-0000-000000003654'),'pending','indexação pendente intacta');
select lives_ok($$select public.dispatch_ai_worker()$$,'dispatch segue funcionando');

-- código de erro é validado
insert into public.ai_jobs(id,organization_id,kind,conversation_id,state,attempts,claim_token,claimed_until) values
  ('00000000-0000-0000-0000-000000003655',:'oa','reply','00000000-0000-0000-0000-000000003623','running',1,'00000000-0000-0000-0000-0000000036a1',now()+interval '1 minute'),
  ('00000000-0000-0000-0000-000000003656',:'oa','reply','00000000-0000-0000-0000-000000003623','running',1,'00000000-0000-0000-0000-0000000036a2',now()+interval '1 minute');
select public.fail_ai_job('00000000-0000-0000-0000-000000003655','00000000-0000-0000-0000-0000000036a1','Texto da mensagem: oi!',false);
select public.fail_ai_job('00000000-0000-0000-0000-000000003656','00000000-0000-0000-0000-0000000036a2',repeat('a',65),false);
select is((select last_error from public.ai_jobs where id='00000000-0000-0000-0000-000000003655'),'invalid_code','código inseguro vira invalid_code');
select is((select last_error from public.ai_jobs where id='00000000-0000-0000-0000-000000003656'),'invalid_code','código longo vira invalid_code');

-- uma resposta por conversa por vez
delete from public.ai_jobs;
insert into public.ai_jobs(id,organization_id,kind,conversation_id,state,attempts,claim_token,claimed_until) values
  ('00000000-0000-0000-0000-000000003671',:'oa','reply','00000000-0000-0000-0000-000000003621','running',1,gen_random_uuid(),now()+interval '1 minute');
insert into public.ai_jobs(id,organization_id,kind,conversation_id,run_after) values
  ('00000000-0000-0000-0000-000000003672',:'oa','reply','00000000-0000-0000-0000-000000003621',now()-interval '1 second'),
  ('00000000-0000-0000-0000-000000003673',:'oa','reply','00000000-0000-0000-0000-000000003622',now()-interval '1 second');
select public.claim_ai_jobs(5) as c5 \gset
select is(jsonb_array_length(:'c5'::jsonb),1,'resposta em curso bloqueia a pendente da mesma conversa');
select is(:'c5'::jsonb->0->>'jobId','00000000-0000-0000-0000-000000003673','outra conversa não é afetada');
select is((select state from public.ai_jobs where id='00000000-0000-0000-0000-000000003672'),'pending','pendente da conversa ocupada continua pendente');
update public.ai_jobs set state='done', claim_token=null, claimed_until=null where id='00000000-0000-0000-0000-000000003671';
select public.claim_ai_jobs(5) as c6 \gset
select is(:'c6'::jsonb->0->>'jobId','00000000-0000-0000-0000-000000003672','concluída a resposta em curso, a pendente é reservada');
delete from public.ai_jobs;
insert into public.ai_jobs(id,organization_id,kind,conversation_id,state,attempts,claim_token,claimed_until) values
  ('00000000-0000-0000-0000-000000003674',:'oa','reply','00000000-0000-0000-0000-000000003622','running',1,gen_random_uuid(),now()+interval '1 minute');
insert into public.ai_jobs(id,organization_id,kind,conversation_id,run_after) values
  ('00000000-0000-0000-0000-000000003675',:'oa','reply','00000000-0000-0000-0000-000000003622',now()-interval '1 second');
select is(jsonb_array_length(public.claim_ai_jobs(5)),0,'reserva válida em curso bloqueia a nova resposta');
update public.ai_jobs set claimed_until=now()-interval '1 second' where id='00000000-0000-0000-0000-000000003674';
select public.sweep_ai_jobs();
select public.claim_ai_jobs(5) as c7 \gset
select is(:'c7'::jsonb->0->>'jobId','00000000-0000-0000-0000-000000003675','reserva vencida e varrida libera a pendente');
select is((select state from public.ai_jobs where id='00000000-0000-0000-0000-000000003674'),'cancelled','tarefa vencida substituída é cancelada');

-- uma linha com erro não bloqueia a varredura nem o dispatch
create or replace function private.ai_job_gave_up(job public.ai_jobs) returns void
language plpgsql as $$ begin raise exception 'boom'; end $$;
delete from public.ai_jobs;
insert into public.ai_jobs(id,organization_id,kind,conversation_id,state,attempts,claim_token,claimed_until) values
  ('00000000-0000-0000-0000-000000003661',:'oa','reply','00000000-0000-0000-0000-000000003621','running',3,gen_random_uuid(),now()-interval '2 seconds'),
  ('00000000-0000-0000-0000-000000003662',:'oa','reply','00000000-0000-0000-0000-000000003622','running',1,gen_random_uuid(),now()-interval '1 second');
insert into public.ai_jobs(organization_id,kind,conversation_id,run_after) values (:'oa','reply','00000000-0000-0000-0000-000000003623',now()-interval '1 second');
select count(*)::int as before_http2 from net.http_request_queue \gset
select lives_ok($$select public.dispatch_ai_worker()$$,'dispatch sobrevive a linha com erro');
select is((select state from public.ai_jobs where id='00000000-0000-0000-0000-000000003661'),'running','linha com erro permanece como estava');
select is((select state from public.ai_jobs where id='00000000-0000-0000-0000-000000003662'),'pending','demais linhas são processadas');
select is((select count(*)::int from net.http_request_queue), :before_http2 + 1, 'dispatch ainda chama o worker');
select * from finish();
rollback;
