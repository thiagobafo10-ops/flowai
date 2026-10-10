begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select tests.create_user('a17@t.test') as ua \gset
select tests.create_user('agent17@t.test') as uagent \gset
select tests.create_org(:'ua', 'Org A17') as org_a \gset
select tests.add_member(:'org_a', :'uagent', 'agent');

insert into public.tags (id, organization_id, name) values
  ('00000000-0000-0000-0000-0000000001f1', :'org_a', 'VIP17'),
  ('00000000-0000-0000-0000-0000000001f2', :'org_a', 'Quente17');

select tests.authenticate_as(:'uagent');
select public.save_contact(:'org_a', null,
  '{"name":"Maria","phone":"+5511900000017"}'::jsonb,
  array['00000000-0000-0000-0000-0000000001f1','00000000-0000-0000-0000-0000000001f2']::uuid[],
  '[{"key":"cidade","value":"SP"}]'::jsonb) as cid \gset

-- tags nulas preservam tags; substitui campos
select public.save_contact(:'org_a', :'cid', '{}'::jsonb, null, '[{"key":"uf","value":"SP"}]'::jsonb);
select is((select count(*)::int from public.contact_tags where contact_id = :'cid'), 2, 'p_tag_ids nulo mantém tags');
select is((select string_agg(key, ',') from public.contact_custom_fields where contact_id = :'cid'), 'uf', 'campos substituídos');

-- campos nulos preservam campos; substitui tags
select public.save_contact(:'org_a', :'cid', '{}'::jsonb,
  array['00000000-0000-0000-0000-0000000001f1']::uuid[], null);
select is((select count(*)::int from public.contact_custom_fields where contact_id = :'cid'), 1, 'p_custom_fields nulo mantém campos');

-- p_data vazio preserva nome/telefone
select is((select name || '|' || phone from public.contacts where id = :'cid'), 'Maria|+5511900000017', 'p_data vazio mantém dados');

-- array vazio limpa
select public.save_contact(:'org_a', :'cid', '{}'::jsonb, '{}'::uuid[], null);
select is((select count(*)::int from public.contact_tags where contact_id = :'cid'), 0, 'array vazio limpa tags');
select tests.clear_authentication();

select * from finish();
rollback;
