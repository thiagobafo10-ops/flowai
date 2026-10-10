begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select tests.create_user('o18@t.test') as uo \gset
select tests.create_user('agent18@t.test') as uagent \gset
select tests.create_user('b18@t.test') as ub \gset

select tests.authenticate_as(:'uo');
select public.create_organization_with_owner('Org A18') as org_a \gset
select tests.authenticate_as(:'ub');
select public.create_organization_with_owner('Org B18') as org_b \gset
select tests.clear_authentication();
select tests.add_member(:'org_a', :'uagent', 'agent');

select id as pipe from public.pipelines where organization_id = :'org_a' and is_default \gset

-- ============================================================ pipelines: só renomear
select tests.authenticate_as(:'uo');
select throws_ok(format($$delete from public.pipelines where id = %L$$, :'pipe'),
  '42501', null, 'owner não exclui pipeline direto');
select throws_ok(format($$insert into public.pipelines (organization_id, name) values (%L, 'Outro')$$, :'org_a'),
  '42501', null, 'owner não insere pipeline direto');
select throws_ok(format($$update public.pipelines set is_default = false where id = %L$$, :'pipe'),
  '42501', null, 'owner não altera is_default');
select lives_ok(format($$update public.pipelines set name = 'Vendas' where id = %L$$, :'pipe'),
  'owner renomeia pipeline');
select tests.clear_authentication();
select is((select name from public.pipelines where id = :'pipe'), 'Vendas', 'nome do pipeline atualizado');
select is((select count(*)::int from public.pipelines where organization_id = :'org_a'), 1, 'pipeline continua único');
select ok((select is_default from public.pipelines where id = :'pipe'), 'pipeline continua padrão');

-- ============================================================ contacts: identidade do canal
insert into public.contacts (organization_id, name, source, whatsapp_id)
  values (:'org_a', 'Canal', 'whatsapp', '5511900000018') returning id as cw \gset

select tests.authenticate_as(:'uagent');
select throws_ok(format($$update public.contacts set source = 'manual' where id = %L$$, :'cw'),
  '42501', null, 'agente não altera source');
select throws_ok(format($$update public.contacts set whatsapp_id = '1' where id = %L$$, :'cw'),
  '42501', null, 'agente não altera whatsapp_id');
select throws_ok(format($$update public.contacts set instagram_id = 'x' where id = %L$$, :'cw'),
  '42501', null, 'agente não altera instagram_id');
select throws_ok(format($$update public.contacts set last_interaction_at = now() where id = %L$$, :'cw'),
  '42501', null, 'agente não altera last_interaction_at');
select lives_ok(format($$update public.contacts set name = 'Canal 2', phone = '+5511900000018', email = 'c@t.test',
  avatar_url = null, status = 'customer', lead_score = 10, assigned_to = %L where id = %L$$, :'uagent', :'cw'),
  'agente altera os demais campos');
select lives_ok(format($$select public.save_contact(%L, %L, '{"name":"Canal 3","lead_score":20}'::jsonb, null, null)$$,
  :'org_a', :'cw'), 'save_contact (edição) continua funcionando');
select public.save_contact(:'org_a', null, '{"name":"Novo18"}'::jsonb, '{}'::uuid[], '[]'::jsonb) as cnew \gset
select tests.clear_authentication();
select is((select name || '|' || lead_score || '|' || source || '|' || whatsapp_id from public.contacts where id = :'cw'),
  'Canal 3|20|whatsapp|5511900000018', 'identidade do canal preservada; edição aplicada');
select is((select source::text from public.contacts where id = :'cnew'), 'manual', 'save_contact (criação) continua funcionando');

-- ============================================================ save_contact: responsável de outra org
select tests.authenticate_as(:'uagent');
select throws_ok(format($$select public.save_contact(%L, %L, %L::jsonb, null, null)$$,
  :'org_a', :'cw', json_build_object('assigned_to', :'ub')::text),
  '23503', null, 'save_contact com responsável de outra org => 23503');
select tests.clear_authentication();

-- ============================================================ excluir tag em uso
insert into public.tags (organization_id, name) values (:'org_a', 'Usada18') returning id as tg \gset
insert into public.contact_tags (organization_id, contact_id, tag_id) values (:'org_a', :'cw', :'tg');
select tests.authenticate_as(:'uo');
select lives_ok(format($$delete from public.tags where id = %L$$, :'tg'), 'owner exclui tag em uso');
select tests.clear_authentication();
select is((select count(*)::int from public.contact_tags where tag_id = :'tg'), 0, 'vínculos da tag excluída removidos');

select * from finish();
rollback;
