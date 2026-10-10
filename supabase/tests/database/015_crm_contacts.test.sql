begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

select tests.create_user('a15@t.test') as ua \gset
select tests.create_user('b15@t.test') as ub \gset
select tests.create_user('view15@t.test') as uview \gset
select tests.create_user('agent15@t.test') as uagent \gset
select tests.create_user('admin15@t.test') as uadmin \gset
select tests.create_org(:'ua', 'Org A') as org_a \gset
select tests.create_org(:'ub', 'Org B') as org_b \gset
select tests.add_member(:'org_a', :'uview', 'viewer');
select tests.add_member(:'org_a', :'uagent', 'agent');
select tests.add_member(:'org_a', :'uadmin', 'admin');

insert into public.tags (id, organization_id, name) values
  ('00000000-0000-0000-0000-0000000000f1', :'org_a', 'VIP'),
  ('00000000-0000-0000-0000-0000000000f2', :'org_a', 'Quente'),
  ('00000000-0000-0000-0000-0000000000f3', :'org_b', 'OutraOrg');

-- ============================================================ save_contact
select tests.authenticate_as(:'uagent');
select public.save_contact(:'org_a', null,
  '{"name":"Maria","phone":"+5511900000001","email":"maria@x.com","lead_score":10}'::jsonb,
  array['00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000f2']::uuid[],
  '[{"key":"cidade","value":"SP"}]'::jsonb) as cid \gset
select tests.clear_authentication();
select is((select source::text from public.contacts where id = :'cid'), 'manual', 'save_contact cria com source manual');
select is((select count(*)::int from public.contact_tags where contact_id = :'cid'), 2, 'cria com 2 tags');
select is((select count(*)::int from public.contact_custom_fields where contact_id = :'cid'), 1, 'cria com 1 campo');

select tests.authenticate_as(:'uagent');
select public.save_contact(:'org_a', :'cid', '{"name":"Maria S"}'::jsonb,
  array['00000000-0000-0000-0000-0000000000f1']::uuid[], '[]'::jsonb) as cid2 \gset
select tests.clear_authentication();
select is(:'cid2'::uuid, :'cid'::uuid, 'update retorna o mesmo id');
select is((select name from public.contacts where id = :'cid'), 'Maria S', 'update altera nome');
select is((select count(*)::int from public.contact_tags where contact_id = :'cid'), 1, 'substitui tags');
select is((select count(*)::int from public.contact_custom_fields where contact_id = :'cid'), 0, 'substitui campos');

select tests.authenticate_as(:'uagent');
select throws_ok(format($$select public.save_contact(%L, null, '{"name":"Z"}'::jsonb,
  array['00000000-0000-0000-0000-0000000000f3']::uuid[], '[]'::jsonb)$$, :'org_a'),
  '23503', null, 'tag de outra org rejeitada');
select throws_ok(format($$select public.save_contact(%L, '00000000-0000-0000-0000-00000000dead', '{"name":"Z"}'::jsonb,
  '{}'::uuid[], '[]'::jsonb)$$, :'org_a'),
  'P0002', null, 'contato inexistente');
select tests.clear_authentication();
select is((select count(*)::int from public.contacts where organization_id = :'org_a'), 1, 'nada gravado na falha');

select tests.authenticate_as(:'uview');
select throws_ok(format($$select public.save_contact(%L, null, '{"name":"V"}'::jsonb, '{}'::uuid[], '[]'::jsonb)$$, :'org_a'),
  '42501', null, 'viewer não salva contato');
select tests.clear_authentication();

-- ============================================================ search_contacts
insert into public.contacts (organization_id, name, phone, assigned_to) values
  (:'org_a', 'João Silva', '+5511999998888', :'uagent'),
  (:'org_a', 'Ana', '+5521888877776', null);
select tests.authenticate_as(:'uagent');
select is((select count(*)::int from public.search_contacts(:'org_a','joao',null,null,null,null,'nome',50,0)), 1, 'busca sem acento');
select is((select count(*)::int from public.search_contacts(:'org_a','99998888',null,null,null,null,'nome',50,0)), 1, 'busca por dígitos do telefone');
select is((select count(*)::int from public.search_contacts(:'org_a',null,null,null,'nenhum',null,'nome',50,0)), 2, 'assignee nenhum');
select is((select max(total_count)::int from public.search_contacts(:'org_a',null,null,null,null,null,'interacao',1,0)), 3, 'total_count com limit 1');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.search_contacts(:'org_a',null,null,null,null,null,'nome',50,0)), 0, 'org B não vê contatos de A');

-- ============================================================ tags admin-only
select tests.authenticate_as(:'uagent');
update public.tags set name = 'Renomeada' where id = '00000000-0000-0000-0000-0000000000f1';
select tests.clear_authentication();
select is((select name from public.tags where id = '00000000-0000-0000-0000-0000000000f1'), 'VIP', 'agent não renomeia tag');
select tests.authenticate_as(:'uadmin');
update public.tags set name = 'Renomeada' where id = '00000000-0000-0000-0000-0000000000f1';
select tests.clear_authentication();
select is((select name from public.tags where id = '00000000-0000-0000-0000-0000000000f1'), 'Renomeada', 'admin renomeia tag');

-- ============================================================ auditoria
select tests.authenticate_as(:'uadmin');
delete from public.contacts where id = :'cid';
select tests.clear_authentication();
select is((select count(*)::int from public.audit_logs where action = 'contacts.delete' and entity_id = :'cid'), 1, 'delete de contato auditado');

select * from finish();
rollback;
