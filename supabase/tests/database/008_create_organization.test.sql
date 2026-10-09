begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select tests.create_user('u@t.test') as u \gset
select tests.authenticate_as(:'u');
select public.create_organization_with_owner('  Açaí & Cia!!  ') as org \gset
select tests.clear_authentication();

select is((select name from public.organizations where id = :'org'), 'Açaí & Cia!!', 'nome aparado');
select matches((select slug from public.organizations where id = :'org'), '^acai-cia-[0-9a-f]{6}$', 'slug');
select is((select role::text from public.memberships where organization_id = :'org' and user_id = :'u'), 'owner', 'criador é owner');
select is((select array_agg(s.name order by s.position) from public.pipeline_stages s where s.organization_id = :'org'),
  array['Novo','Interessado','Qualificado','Orçamento','Negociação','Ganho','Perdido'], 'etapas em ordem');
select is((select array_agg(position order by position) from public.pipeline_stages where organization_id = :'org'),
  array[0,1,2,3,4,5,6], 'posições 0-6');
select ok((select bool_and(is_won) from public.pipeline_stages where organization_id = :'org' and name = 'Ganho')
  and (select bool_and(is_lost) from public.pipeline_stages where organization_id = :'org' and name = 'Perdido'), 'flags won/lost');
select is((select count(*)::int from public.pipelines where organization_id = :'org' and is_default and name = 'Pipeline padrão'), 1, 'pipeline padrão');
select is((select count(*)::int from public.ai_agents where organization_id = :'org'), 1, 'um agente');
select is((select (name, is_active, auto_reply, human_handoff)::text from public.ai_agents where organization_id = :'org'),
  '(Assistente,f,f,t)', 'defaults do agente');
select is((select count(*)::int from public.audit_logs where organization_id = :'org' and action = 'organization.created'), 1, 'auditoria');

select tests.authenticate_as(:'u');
select throws_ok($$select public.create_organization_with_owner('   ')$$, '22023', 'invalid_organization_name', 'nome vazio');
select tests.clear_authentication();
select throws_ok($$select public.create_organization_with_owner('X')$$, '42501', null, 'sem autenticação (postgres)');
set local role anon;
select throws_ok($$select public.create_organization_with_owner('X')$$, '42501', null, 'anon sem permissão');

select * from finish();
rollback;
