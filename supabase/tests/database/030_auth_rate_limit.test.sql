begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- check_rate_limit é só para código de servidor (service_role e funções definer).
set local role anon;
select throws_ok($$select public.check_rate_limit('meta:x', 1000, 60)$$, '42501', null, 'anon não executa check_rate_limit');
reset role;
select tests.create_user('rl30@t.test') as u \gset
select tests.authenticate_as(:'u');
select throws_ok($$select public.check_rate_limit('meta:x', 1000, 60)$$, '42501', null, 'authenticated não executa check_rate_limit');
select tests.clear_authentication();
set local role service_role;
select ok(public.check_rate_limit('meta-ip:30', 2, 60), 'service_role continua usando check_rate_limit');
reset role;

-- Wrapper público: somente signup/login e chave sempre com namespace.
set local role anon;
select ok(public.check_auth_rate_limit('signup', '10.0.0.30', 2, 60), 'signup 1 permitido');
select ok(public.check_auth_rate_limit('signup', '10.0.0.30', 2, 60), 'signup 2 permitido');
select ok(not public.check_auth_rate_limit('signup', '10.0.0.30', 2, 60), 'signup 3 bloqueado');
select ok(public.check_auth_rate_limit('login', '10.0.0.30', 2, 60), 'login tem bucket próprio');
select throws_ok($$select public.check_auth_rate_limit('meta', '00000000-0000-4000-8000-000000000001', 1, 60)$$, '22023', null, 'outros tipos são rejeitados');
select throws_ok($$select public.check_auth_rate_limit('meta-ip', '1.2.3.4', 1, 60)$$, '22023', null, 'não esgota buckets do webhook');
select throws_ok($$select public.check_auth_rate_limit('signup', '', 1, 60)$$, '22023', null, 'assunto vazio rejeitado');
reset role;
select is((select count(*)::int from public.rate_limits where key = 'signup:10.0.0.30'), 1, 'chave gravada com namespace do tipo');

select * from finish();
rollback;
