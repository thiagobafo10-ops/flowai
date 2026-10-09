begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select tests.create_user('a@t.test') as ua \gset
select tests.create_user('b@t.test') as ub \gset
select tests.create_user('agent@t.test') as uagent \gset
select tests.create_org(:'ua', 'Org A') as org_a \gset
select tests.create_org(:'ub', 'Org B') as org_b \gset
select tests.add_member(:'org_a', :'uagent', 'agent');

select is((select full_name from public.profiles where id = :'ua'), 'Test User', 'profile criado pelo trigger');

select tests.authenticate_as(:'ua');
select is((select count(*)::int from public.organizations), 1, 'A vê só a própria org');
select is((select count(*)::int from public.organizations where id = :'org_b'), 0, 'A não vê org B');
select is((select count(*)::int from public.memberships where organization_id = :'org_b'), 0, 'A não vê memberships de B');
select ok(public.has_role(:'org_a', 'owner'), 'A é owner de A');
select ok(not public.is_member(:'org_b'), 'A não é membro de B');
select is((select count(*)::int from public.profiles where id = :'ub'), 0, 'A não vê profile de B');

-- Review Focus #1: escalada de papel
select tests.authenticate_as(:'uagent');
update public.memberships set role = 'owner' where user_id = :'uagent';
select tests.clear_authentication();
select is((select role::text from public.memberships where user_id = :'uagent'), 'agent', 'agent não se promove');

select tests.authenticate_as(:'uagent');
select throws_ok(
  format($$insert into public.memberships(organization_id, user_id, role) values (%L, %L, 'owner')$$, :'org_a', :'ub'),
  '42501', null, 'agent não adiciona membros');
select lives_ok(format($$update public.organizations set name = 'X' where id = %L$$, :'org_a'), 'update sem permissão não erra…');
select tests.clear_authentication();
select is((select name from public.organizations where id = :'org_a'), 'Org A', '…mas não altera (agent não é admin)');

select * from finish();
rollback;
