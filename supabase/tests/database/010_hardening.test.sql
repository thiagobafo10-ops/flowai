begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

select tests.create_user('owner@t.test') as uowner \gset
select tests.create_user('admin@t.test') as uadmin \gset
select tests.create_user('agent@t.test') as uagent \gset
select tests.create_user('out@t.test') as uout \gset
select tests.create_org(:'uowner', 'Org H') as org \gset
select tests.add_member(:'org', :'uadmin', 'admin');
select tests.add_member(:'org', :'uagent', 'agent');

-- ---------------------------------------------------------------- events
select tests.authenticate_as(:'uagent');
select throws_ok(format($$insert into public.events(organization_id, type, actor_type, actor_id) values (%L, 'deal.won', 'user', %L)$$, :'org', :'uagent'),
  '42501', null, 'agent não forja deal.won');
select tests.authenticate_as(:'uowner');
select throws_ok(format($$insert into public.events(organization_id, type, actor_type, actor_id) values (%L, 'deal.won', 'user', %L)$$, :'org', :'uowner'),
  '42501', null, 'nem owner insere events diretamente');
select tests.clear_authentication();
select ok(not has_any_column_privilege('authenticated', 'public.events', 'insert'), 'authenticated sem INSERT (nem por coluna) em events');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'events' and cmd = 'INSERT'), 0, 'sem policy de insert em events');
select lives_ok(format($$insert into public.events(organization_id, type, actor_type) values (%L, 'deal.won', 'system')$$, :'org'),
  'código privilegiado (postgres) ainda insere events');

-- ---------------------------------------------------------------- write_audit_log
select ok(not has_function_privilege('authenticated', 'public.write_audit_log(uuid, text, text, uuid, jsonb, inet)', 'execute'),
  'authenticated não executa write_audit_log');
select tests.authenticate_as(:'uowner');
select throws_ok(format($$select public.write_audit_log(%L, 'deal.won', 'organization', %L)$$, :'org', :'org'),
  '42501', null, 'owner não forja audit log via RPC');
select public.create_organization_with_owner('Org Definer') as org2 \gset
select tests.clear_authentication();
select is((select actor_id from public.audit_logs where organization_id = :'org2' and action = 'organization.created'), :'uowner'::uuid,
  'função definer ainda grava audit log');

-- ---------------------------------------------------------------- log_auth_event
select tests.authenticate_as(:'uagent');
select lives_ok($$select public.log_auth_event('auth.login', '10.0.0.1'::inet)$$, 'log_auth_event auth.login');
select tests.clear_authentication();
select is(
  (select (organization_id is null, actor_id, entity_type, entity_id, host(ip))::text from public.audit_logs where action = 'auth.login'),
  format('(t,%s,user,%s,10.0.0.1)', :'uagent', :'uagent'),
  'linha auth.login: org nula, actor/entity = usuário, ip');
select tests.authenticate_as(:'uagent');
select throws_ok($$select public.log_auth_event('organization.deleted')$$, '22023', null, 'ação fora da allowlist rejeitada');
select throws_ok($$select public.log_auth_event(null)$$, '22023', null, 'ação nula rejeitada');
select tests.clear_authentication();
select throws_ok($$select public.log_auth_event('auth.login')$$, '42501', null, 'log_auth_event exige auth.uid()');
select ok(not has_function_privilege('anon', 'public.log_auth_event(text, inet)', 'execute'), 'anon não executa log_auth_event');
select ok(has_function_privilege('authenticated', 'public.log_auth_event(text, inet)', 'execute'), 'authenticated executa log_auth_event');

-- ---------------------------------------------------------------- constraints de audit_logs
select throws_ok($$insert into public.audit_logs(action, entity_type) values (repeat('a', 101), 'x')$$, '23514', null, 'action > 100 rejeitada');
select lives_ok($$insert into public.audit_logs(action, entity_type) values (repeat('a', 100), 'x')$$, 'action = 100 aceita');
select throws_ok($$insert into public.audit_logs(action, entity_type) values ('x', repeat('e', 101))$$, '23514', null, 'entity_type > 100 rejeitado');
select throws_ok($$insert into public.audit_logs(action, entity_type, metadata) values ('x', 'x', jsonb_build_object('k', repeat(md5(random()::text), 400)))$$,
  '23514', null, 'metadata > 8KB rejeitado');

-- ---------------------------------------------------------------- trigger genérico de auditoria
-- troca de papel
select tests.authenticate_as(:'uadmin');
update public.memberships set role = 'viewer' where organization_id = :'org' and user_id = :'uagent';
select tests.clear_authentication();
select is((select count(*)::int from public.audit_logs a join public.memberships m on m.id = a.entity_id
  where a.action = 'memberships.update' and m.user_id = :'uagent'), 1, 'troca de papel gera um audit');
select is((select (a.actor_id, a.organization_id, a.entity_type, a.metadata)::text from public.audit_logs a
  join public.memberships m on m.id = a.entity_id where a.action = 'memberships.update' and m.user_id = :'uagent'),
  format('(%s,%s,memberships,"{""changed"": [""role""]}")', :'uadmin', :'org'), 'audit da troca de papel: ator, org, colunas');

-- channel update: só nomes de colunas, nunca valores
insert into public.channels (id, organization_id, type, name)
  values ('00000000-0000-0000-0000-00000000c4a1', :'org', 'whatsapp', 'Canal');
update public.channels set name = 'Canal 2', access_token_secret_id = '00000000-0000-0000-0000-00000000dead'
  where id = '00000000-0000-0000-0000-00000000c4a1';
select is((select count(*)::int from public.audit_logs where action = 'channels.update' and entity_id = '00000000-0000-0000-0000-00000000c4a1'), 1,
  'update de canal gera um audit');
select is((select metadata from public.audit_logs where action = 'channels.update' and entity_id = '00000000-0000-0000-0000-00000000c4a1'),
  '{"changed": ["access_token_secret_id", "name"]}'::jsonb, 'metadata lista nomes de colunas alteradas');
select ok((select metadata::text not like '%dead%' and metadata::text not like '%Canal%' from public.audit_logs
  where action = 'channels.update' and entity_id = '00000000-0000-0000-0000-00000000c4a1'), 'metadata não contém valores');
select is((select count(*)::int from public.audit_logs where action = 'channels.insert' and entity_id = '00000000-0000-0000-0000-00000000c4a1'), 1,
  'insert de canal auditado');
select is((select actor_id from public.audit_logs where action = 'channels.insert' and entity_id = '00000000-0000-0000-0000-00000000c4a1'), null,
  'actor nulo para service role/postgres');

-- automation insert (admin via API)
select tests.authenticate_as(:'uadmin');
insert into public.automations (id, organization_id, name, trigger_type)
  values ('00000000-0000-0000-0000-0000000a0701', :'org', 'Auto', 'contact_created');
select tests.clear_authentication();
select is((select (count(*), min(actor_id::text), min(organization_id::text))::text from public.audit_logs
  where action = 'automations.insert' and entity_id = '00000000-0000-0000-0000-0000000a0701'),
  format('(1,%s,%s)', :'uadmin', :'org'), 'insert de automação gera um audit com ator e org');

-- ai_agents update
update public.ai_agents set name = 'Novo nome' where organization_id = :'org2';
select is((select metadata from public.audit_logs where action = 'ai_agents.update' and organization_id = :'org2'),
  '{"changed": ["name"]}'::jsonb, 'update de ai_agent auditado');

-- organizations: update + column grant
select tests.authenticate_as(:'uadmin');
select throws_ok(format($$update public.organizations set slug = 'hack' where id = %L$$, :'org'), '42501', null, 'admin não altera slug');
select lives_ok(format($$update public.organizations set name = 'Org H2', timezone = 'America/Manaus' where id = %L$$, :'org'), 'admin altera nome');
select tests.clear_authentication();
select is((select name from public.organizations where id = :'org'), 'Org H2', 'nome alterado');
select is((select metadata from public.audit_logs where action = 'organizations.update' and entity_id = :'org'),
  '{"changed": ["name", "timezone"]}'::jsonb, 'update de organização auditado (sem updated_at)');

-- exclusão de org não é bloqueada e gera um audit
select tests.authenticate_as(:'uowner');
select lives_ok(format($$delete from public.organizations where id = %L$$, :'org'), 'owner exclui org');
select tests.clear_authentication();
select is((select count(*)::int from public.organizations where id = :'org'), 0, 'org excluída');
select is((select (count(*), min(actor_id::text), min(organization_id::text))::text from public.audit_logs
  where action = 'organizations.delete' and entity_id = :'org'),
  format('(1,%s,%s)', :'uowner', :'org'), 'exclusão de org gera um audit');

-- sem recursão: audit_logs não tem trigger de auditoria
select is((select array_agg(tgname::text) from pg_trigger where tgrelid = 'public.audit_logs'::regclass and not tgisinternal),
  array['audit_logs_append_only'], 'audit_logs só tem o trigger append-only');

select * from finish();
rollback;
