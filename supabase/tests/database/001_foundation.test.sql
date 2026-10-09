begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
select has_extension('vector');
select has_extension('pgmq');
select has_extension('pg_cron');
select has_extension('unaccent');
select has_type('public', 'org_role', 'enum org_role existe');
select is(public.role_rank('owner'), 4);
select ok(public.role_rank('admin') > public.role_rank('agent') and public.role_rank('agent') > public.role_rank('viewer'), 'hierarquia de papéis');

-- smoke test dos helpers
select tests.create_user('u1@example.com') as u1 \gset
select tests.create_user('u2@example.com') as u2 \gset
select tests.authenticate_as(:'u1'::uuid);
select is(auth.uid(), :'u1'::uuid, 'authenticate_as define auth.uid()');
select tests.authenticate_as(:'u2'::uuid);
select is(auth.uid(), :'u2'::uuid, 'authenticate_as troca de usuário');
select tests.clear_authentication();
select ok(auth.uid() is null, 'clear_authentication limpa auth.uid()');
select is(current_user::text, 'postgres', 'role volta para postgres');
select is(has_function_privilege('authenticated', 'tests.create_user(text,text)', 'execute'), false, 'create_user não executável por authenticated');
select * from finish();
rollback;
