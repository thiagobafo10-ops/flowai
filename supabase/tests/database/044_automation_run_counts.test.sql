begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
select tests.create_user('owner44@t.test','Dona Ana') as ua \gset
select tests.create_user('owner44b@t.test','Outra') as ub \gset
select tests.create_org(:'ua','Org44A') as oa \gset
select tests.create_org(:'ub','Org44B') as ob \gset

insert into public.automations (id, organization_id, name, trigger_type, trigger_config) values
  ('00000000-0000-0000-0000-000000004401', :'oa', 'A1', 'message_received', '{"firstMessageOnly":false}'),
  ('00000000-0000-0000-0000-000000004402', :'oa', 'A2', 'message_received', '{"firstMessageOnly":false}');
create function pg_temp.run(p_k int, p_auto uuid, p_age interval) returns void language plpgsql as $$
declare v_event uuid;
begin
  insert into public.events (organization_id, type, actor_type, payload)
    values ((select organization_id from public.automations where id = p_auto), 'automation_trigger', 'system', '{}')
    returning id into v_event;
  insert into public.automation_runs (organization_id, automation_id, trigger_event_id, status, created_at)
    values ((select organization_id from public.automations where id = p_auto), p_auto, v_event, 'completed', now() - p_age);
end $$;
select pg_temp.run(1, '00000000-0000-0000-0000-000000004401', interval '1 day');
select pg_temp.run(2, '00000000-0000-0000-0000-000000004401', interval '2 days');
select pg_temp.run(3, '00000000-0000-0000-0000-000000004401', interval '10 days');
select pg_temp.run(4, '00000000-0000-0000-0000-000000004402', interval '3 days');

select ok(not has_function_privilege('anon','public.automation_run_counts(uuid,timestamptz)','execute'),'anon não executa');
select ok(has_function_privilege('authenticated','public.automation_run_counts(uuid,timestamptz)','execute'),'authenticated executa');

select tests.authenticate_as(:'ua');
select results_eq(format($q$select automation_id, runs from public.automation_run_counts(%L, now() - interval '7 days') order by automation_id$q$, :'oa'),
  $q$values ('00000000-0000-0000-0000-000000004401'::uuid, 2::bigint), ('00000000-0000-0000-0000-000000004402'::uuid, 1::bigint)$q$,
  'conta apenas a janela de 7 dias');
select results_eq(format($q$select runs from public.automation_run_counts(%L, now() - interval '30 days') where automation_id = '00000000-0000-0000-0000-000000004401'$q$, :'oa'),
  $q$values (3::bigint)$q$, 'janela maior inclui a execução antiga');
select is_empty(format($q$select * from public.automation_run_counts(%L, now() - interval '30 days')$q$, :'ob'),
  'organização alheia não retorna contagens');
select tests.authenticate_as(:'ub');
select is_empty(format($q$select * from public.automation_run_counts(%L, now() - interval '30 days')$q$, :'oa'),
  'membro de outra organização não vê as contagens');
select * from finish();
rollback;
