begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select tests.create_user('a@t.test') as ua \gset
select tests.create_user('b@t.test') as ub \gset
select tests.create_user('agent@t.test') as uagent \gset
select tests.create_user('admin@t.test') as uadmin \gset
select tests.create_org(:'ua', 'Org A') as org_a \gset
select tests.add_member(:'org_a', :'uagent', 'agent');
select tests.add_member(:'org_a', :'uadmin', 'admin');

-- write_audit_log
select tests.authenticate_as(:'ua');
select lives_ok(
  format($$select public.write_audit_log(%L, 'test.action', 'organization', %L)$$, :'org_a', :'org_a'),
  'membro escreve audit log');
select is(
  (select actor_id from public.audit_logs where action = 'test.action'), :'ua'::uuid,
  'actor_id = auth.uid()');

select tests.authenticate_as(:'ub');
select throws_ok(
  format($$select public.write_audit_log(%L, 'test.action', 'organization', %L)$$, :'org_a', :'org_a'),
  null, null, 'não-membro não escreve audit log na org');

-- append-only (inclui postgres)
select tests.clear_authentication();
select throws_ok($$update public.audit_logs set action = 'x'$$, null, 'audit_logs is append-only', 'update bloqueado para postgres');
select throws_ok($$delete from public.audit_logs$$, null, 'audit_logs is append-only', 'delete bloqueado para postgres');

select tests.authenticate_as(:'ub');
select throws_ok('truncate public.audit_logs', '42501', null, 'authenticated não faz TRUNCATE');

-- leitura: só admin+
select tests.authenticate_as(:'uagent');
select is((select count(*)::int from public.audit_logs), 0, 'agent não lê audit logs');
select tests.authenticate_as(:'uadmin');
select is((select count(*)::int from public.audit_logs where organization_id = :'org_a'), 1, 'admin lê audit logs da org');
select tests.authenticate_as(:'ua');
select is((select count(*)::int from public.audit_logs where organization_id = :'org_a'), 1, 'owner lê audit logs da org');

-- linha sem org: só o próprio ator
select lives_ok($$select public.write_audit_log(null, 'auth.login', 'user', null)$$, 'escreve audit log sem org');
select is((select count(*)::int from public.audit_logs where action = 'auth.login'), 1, 'ator lê a própria linha sem org');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.audit_logs where action = 'auth.login'), 0, 'outro usuário não lê linha sem org');

-- anon não escreve audit log
select tests.clear_authentication();
set local role anon;
select throws_ok($$select public.write_audit_log(null, 'auth.login', 'user', null)$$, '42501', null, 'anon não executa write_audit_log');

-- rate limit (anon)
select ok(public.check_rate_limit('k', 3, 60), 'chamada 1 permitida');
select ok(public.check_rate_limit('k', 3, 60), 'chamada 2 permitida');
select ok(public.check_rate_limit('k', 3, 60), 'chamada 3 permitida');
select ok(not public.check_rate_limit('k', 3, 60), 'chamada 4 bloqueada');
select ok(public.check_rate_limit('other', 3, 60), 'outra chave é independente');

-- rate_limits sem policy
reset role;
select tests.authenticate_as(:'ua');
select throws_ok('select count(*) from public.rate_limits', '42501', null, 'authenticated não lê rate_limits');

select * from finish();
rollback;
