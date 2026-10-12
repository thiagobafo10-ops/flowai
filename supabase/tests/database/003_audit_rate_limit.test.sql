begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

select tests.create_user('a@t.test') as ua \gset
select tests.create_user('b@t.test') as ub \gset
select tests.create_user('agent@t.test') as uagent \gset
select tests.create_user('admin@t.test') as uadmin \gset
select tests.create_org(:'ua', 'Org A') as org_a \gset
select tests.add_member(:'org_a', :'uagent', 'agent');
select tests.add_member(:'org_a', :'uadmin', 'admin');

-- write_audit_log: apenas código definer (owner postgres); a API não executa.
select tests.authenticate_as(:'ua');
select throws_ok(
  format($$select public.write_audit_log(%L, 'test.action', 'organization', %L)$$, :'org_a', :'org_a'),
  '42501', null, 'membro não executa write_audit_log diretamente');
select public.create_organization_with_owner('Org Audit') as org_x \gset
select tests.clear_authentication();
select is(
  (select actor_id from public.audit_logs where action = 'organization.created' and organization_id = :'org_x'), :'ua'::uuid,
  'actor_id = auth.uid() (via função definer)');

select tests.authenticate_as(:'ub');
select throws_ok(
  format($$select public.write_audit_log(%L, 'test.action', 'organization', %L)$$, :'org_a', :'org_a'),
  '42501', null, 'não-membro não escreve audit log na org');

-- append-only (inclui postgres)
select tests.clear_authentication();
select throws_ok($$update public.audit_logs set action = 'x'$$, null, 'audit_logs is append-only', 'update bloqueado para postgres');
select throws_ok($$delete from public.audit_logs$$, null, 'audit_logs is append-only', 'delete bloqueado para postgres');

select tests.authenticate_as(:'ub');
select throws_ok('truncate public.audit_logs', '42501', null, 'authenticated não faz TRUNCATE');

-- leitura: só admin+
select tests.clear_authentication();
select count(*)::int as org_a_audit from public.audit_logs where organization_id = :'org_a' \gset
select tests.authenticate_as(:'uagent');
select is((select count(*)::int from public.audit_logs), 0, 'agent não lê audit logs');
select tests.authenticate_as(:'uadmin');
select ok(:org_a_audit > 0, 'org A tem audit logs (triggers)');
select is((select count(*)::int from public.audit_logs where organization_id = :'org_a'), :org_a_audit, 'admin lê audit logs da org');
select tests.authenticate_as(:'ua');
select is((select count(*)::int from public.audit_logs where organization_id = :'org_a'), :org_a_audit, 'owner lê audit logs da org');

-- linha sem org: só o próprio ator
select lives_ok($$select public.log_auth_event('auth.login')$$, 'escreve audit log sem org (log_auth_event)');
select is((select count(*)::int from public.audit_logs where action = 'auth.login'), 1, 'ator lê a própria linha sem org');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.audit_logs where action = 'auth.login'), 0, 'outro usuário não lê linha sem org');

-- anon não escreve audit log
select tests.clear_authentication();
set local role anon;
select throws_ok($$select public.write_audit_log(null, 'auth.login', 'user', null)$$, '42501', null, 'anon não executa write_audit_log');

-- rate limit (servidor; a API pública usa check_auth_rate_limit, ver 030)
reset role;
set local role service_role;
select ok(public.check_rate_limit('k', 3, 60), 'chamada 1 permitida');
select ok(public.check_rate_limit('k', 3, 60), 'chamada 2 permitida');
select ok(public.check_rate_limit('k', 3, 60), 'chamada 3 permitida');
select ok(not public.check_rate_limit('k', 3, 60), 'chamada 4 bloqueada');
select ok(public.check_rate_limit('other', 3, 60), 'outra chave é independente');

-- rate_limits sem policy
reset role;
select tests.authenticate_as(:'ua');
select throws_ok('select count(*) from public.rate_limits', '42501', null, 'authenticated não lê rate_limits');

-- validação de check_rate_limit
select tests.clear_authentication();
set local role service_role;
select throws_ok($$select public.check_rate_limit(null, 3, 60)$$, '22023', null, 'chave nula rejeitada');
select throws_ok(format($$select public.check_rate_limit(%L, 3, 60)$$, repeat('x', 201)), '22023', null, 'chave > 200 rejeitada');
select throws_ok($$select public.check_rate_limit('k2', 0, 60)$$, '22023', null, 'limite 0 rejeitado');
select throws_ok($$select public.check_rate_limit('k2', 3, 0)$$, '22023', null, 'janela 0 rejeitada');
reset role;

-- trilha de auditoria sobrevive à exclusão de org e usuário
select tests.create_user('c@t.test') as uc \gset
select tests.create_org(:'uc', 'Org C') as org_c \gset
insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id)
  values (:'org_c', :'uc', 'test.keep', 'organization', :'org_c');
select lives_ok(format($$delete from public.organizations where id = %L$$, :'org_c'), 'org com audit log pode ser excluída');
select is((select count(*)::int from public.audit_logs where organization_id = :'org_c' and action = 'test.keep'), 1, 'audit log permanece após excluir org');
select lives_ok(format($$delete from auth.users where id = %L$$, :'uc'), 'usuário com audit log pode ser excluído');
select is((select actor_id from public.audit_logs where action = 'test.keep'), :'uc'::uuid, 'audit log permanece com actor_id intacto');

select * from finish();
rollback;
