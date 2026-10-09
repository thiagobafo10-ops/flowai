begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select tests.create_user('rl1@t.test') as u1 \gset
select tests.create_user('rl2@t.test') as u2 \gset

select tests.authenticate_as(:'u1');
select lives_ok($$select public.log_auth_event('auth.login') from generate_series(1, 31)$$,
  '31 chamadas não geram erro');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_logs where action = 'auth.login' and actor_id = :'u1'), 30,
  'apenas 30 eventos gravados por usuário na janela');

select tests.authenticate_as(:'u2');
select lives_ok($$select public.log_auth_event('auth.login')$$, 'outro usuário chama normalmente');
select tests.clear_authentication();
select is((select count(*)::int from public.audit_logs where action = 'auth.login' and actor_id = :'u2'), 1,
  'chave por usuário: outro usuário grava');

select tests.authenticate_as(:'u1');
select throws_ok($$select public.log_auth_event('auth.other')$$, '22023', null, 'allowlist continua valendo');
select tests.clear_authentication();

select * from finish();
rollback;
