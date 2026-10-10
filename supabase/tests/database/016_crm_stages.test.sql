begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

select tests.create_user('o16@t.test') as uo \gset
select tests.create_user('b16@t.test') as ub \gset
select tests.create_user('admin16@t.test') as uadmin \gset
select tests.create_user('agent16@t.test') as uagent \gset

select tests.authenticate_as(:'uo');
select public.create_organization_with_owner('Org A16') as org_a \gset
select tests.authenticate_as(:'ub');
select public.create_organization_with_owner('Org B16') as org_b \gset
select tests.clear_authentication();
select tests.add_member(:'org_a', :'uadmin', 'admin');
select tests.add_member(:'org_a', :'uagent', 'agent');

select id as pipe from public.pipelines where organization_id = :'org_a' and is_default \gset
select id as st_novo from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Novo' \gset
select id as st_int from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Interessado' \gset
select id as st_neg from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Negociação' \gset
select id as st_ganho from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Ganho' \gset
select id as st_perdido from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Perdido' \gset

-- ============================================================ create_stage
select tests.authenticate_as(:'uadmin');
select public.create_stage(:'pipe', 'Proposta') as st_prop \gset
select tests.clear_authentication();
select is((select position from public.pipeline_stages where id = :'st_prop'), 5, 'create_stage: nova etapa na posição 5');
select is((select position from public.pipeline_stages where id = :'st_ganho'), 6, 'create_stage: Ganho vai para 6');
select is((select position from public.pipeline_stages where id = :'st_perdido'), 7, 'create_stage: Perdido vai para 7');
select is((select organization_id from public.pipeline_stages where id = :'st_prop'), :'org_a'::uuid, 'create_stage: org derivada do pipeline');

select tests.authenticate_as(:'uadmin');
select throws_ok(format($$select public.create_stage(%L, 'PROPOSTA')$$, :'pipe'), '23505', null, 'create_stage: nome repetido (caixa) => 23505');
select throws_ok(format($$select public.create_stage(%L, '   ')$$, :'pipe'), '22023', null, 'create_stage: nome vazio => 22023');
select throws_ok(format($$update public.pipeline_stages set name = 'novo' where id = %L$$, :'st_int'), '23505', null, 'renomear para nome repetido (caixa) => 23505');
select lives_ok(format($$update public.pipeline_stages set name = 'Interessado!' where id = %L$$, :'st_int'), 'admin ainda renomeia etapa');
select lives_ok(format($$update public.pipeline_stages set name = 'Interessado' where id = %L$$, :'st_int'), 'admin renomeia de volta');

-- ============================================================ reorder_stages
select throws_ok(format($$select public.reorder_stages(%L, array[%L, %L]::uuid[])$$, :'pipe', :'st_novo', :'st_int'),
  '22023', null, 'reorder_stages: conjunto incompleto => 22023');
select throws_ok(format($$select public.reorder_stages(%L, (select array_agg(id order by position) || array[%L::uuid] from public.pipeline_stages where pipeline_id = %L))$$,
  :'pipe', :'st_novo', :'pipe'), '22023', null, 'reorder_stages: duplicado => 22023');
select public.reorder_stages(:'pipe',
  (select array_agg(id order by (id <> :'st_prop'::uuid), position) from public.pipeline_stages where pipeline_id = :'pipe'));
select tests.clear_authentication();
select is((select array_agg(name order by position) from public.pipeline_stages where pipeline_id = :'pipe'),
  array['Proposta','Novo','Interessado','Qualificado','Orçamento','Negociação','Ganho','Perdido'], 'reorder_stages: ordem aplicada');
select is((select array_agg(position order by position) from public.pipeline_stages where pipeline_id = :'pipe'),
  array[0,1,2,3,4,5,6,7], 'reorder_stages: posições 0..n-1');

-- ============================================================ delete_stage_moving_deals
insert into public.contacts (organization_id, name) values (:'org_a', 'C1') returning id as c1 \gset
insert into public.contacts (organization_id, name) values (:'org_a', 'C2') returning id as c2 \gset
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
  values (:'org_a', :'pipe', :'st_int', :'c1', 'D1');
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
  values (:'org_a', :'pipe', :'st_int', :'c2', 'D2');

select tests.authenticate_as(:'uadmin');
select throws_ok(format($$select public.delete_stage_moving_deals(%L, %L)$$, :'st_ganho', :'st_novo'),
  '22023', 'stage_is_outcome', 'excluir etapa Ganho => 22023 stage_is_outcome');
select throws_ok(format($$select public.delete_stage_moving_deals(%L, %L)$$, :'st_int', :'st_int'),
  '22023', null, 'destino igual à origem => 22023');
select public.delete_stage_moving_deals(:'st_int', :'st_novo');
select tests.clear_authentication();
select is((select count(*)::int from public.deals where stage_id = :'st_novo'), 2, 'deals movidos para o destino');
select is((select count(*)::int from public.pipeline_stages where id = :'st_int'), 0, 'etapa removida');
select is((select array_agg(position order by position) from public.pipeline_stages where pipeline_id = :'pipe'),
  array[0,1,2,3,4,5,6], 'posições contíguas após exclusão');

-- última etapa aberta (pipeline com uma etapa aberta)
insert into public.pipelines (organization_id, name) values (:'org_a', 'Mini') returning id as mini \gset
insert into public.pipeline_stages (organization_id, pipeline_id, name, position, is_won, is_lost) values
  (:'org_a', :'mini', 'Unica', 0, false, false),
  (:'org_a', :'mini', 'G', 1, true, false),
  (:'org_a', :'mini', 'P', 2, false, true);
select id as m_unica from public.pipeline_stages where pipeline_id = :'mini' and name = 'Unica' \gset
select id as m_g from public.pipeline_stages where pipeline_id = :'mini' and name = 'G' \gset
select tests.authenticate_as(:'uadmin');
select throws_ok(format($$select public.delete_stage_moving_deals(%L, %L)$$, :'m_unica', :'m_g'),
  '22023', 'last_open_stage', 'excluir última etapa aberta => 22023 last_open_stage');
select tests.clear_authentication();
select is((select count(*)::int from public.pipeline_stages where pipeline_id = :'mini'), 3, 'mini pipeline intacto');

-- ============================================================ set_stage_outcome
insert into public.contacts (organization_id, name) values (:'org_a', 'C3') returning id as c3 \gset
insert into public.contacts (organization_id, name) values (:'org_a', 'C4') returning id as c4 \gset
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
  values (:'org_a', :'pipe', :'st_neg', :'c3', 'DN') returning id as dn \gset
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
  values (:'org_a', :'pipe', :'st_ganho', :'c4', 'DG') returning id as dg \gset
select is((select status::text from public.deals where id = :'dg'), 'won', 'pré: deal em Ganho é won');

select tests.authenticate_as(:'uadmin');
select throws_ok(format($$select public.set_stage_outcome(%L, 'maybe')$$, :'st_neg'), '22023', null, 'outcome inválido => 22023');
select throws_ok(format($$select public.set_stage_outcome(%L, 'won')$$, :'st_perdido'), '22023', 'outcome_required',
  'tirar a marca Perdido da etapa para torná-la Ganho => outcome_required');
select public.set_stage_outcome(:'st_neg', 'won');
select tests.clear_authentication();
select ok((select is_won and not is_lost from public.pipeline_stages where id = :'st_neg'), 'Negociação é Ganho');
select ok((select not is_won and not is_lost from public.pipeline_stages where id = :'st_ganho'), 'antiga Ganho agora é aberta');
select is((select count(*)::int from public.pipeline_stages where pipeline_id = :'pipe' and is_won), 1, 'exatamente um Ganho');
select is((select status::text from public.deals where id = :'dn'), 'won', 'deal em Negociação ficou won');
select is((select status::text from public.deals where id = :'dg'), 'open', 'deal na antiga Ganho ficou open');

-- conflito: C3 tem deal ganho (DN) e outro aberto; reabrir DN deve falhar
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title)
  values (:'org_a', :'pipe', :'st_novo', :'c3', 'DO');
select tests.authenticate_as(:'uadmin');
select throws_ok(format($$select public.set_stage_outcome(%L, 'won')$$, :'st_ganho'), '23505', null,
  'reabrir deal ganho com outro aberto => 23505');
select tests.clear_authentication();
select ok((select is_won from public.pipeline_stages where id = :'st_neg') and not (select is_won from public.pipeline_stages where id = :'st_ganho'),
  'marcas inalteradas após conflito');

-- ============================================================ permissões
select tests.authenticate_as(:'uagent');
select throws_ok(format($$select public.create_stage(%L, 'X')$$, :'pipe'), '42501', null, 'agent: create_stage => 42501');
select throws_ok(format($$select public.reorder_stages(%L, array[%L]::uuid[])$$, :'pipe', :'st_novo'), '42501', null, 'agent: reorder_stages => 42501');
select throws_ok(format($$select public.delete_stage_moving_deals(%L, %L)$$, :'st_novo', :'st_prop'), '42501', null, 'agent: delete_stage_moving_deals => 42501');
select throws_ok(format($$select public.set_stage_outcome(%L, 'won')$$, :'st_novo'), '42501', null, 'agent: set_stage_outcome => 42501');
select throws_ok(format($$update public.pipeline_stages set is_won = true where id = %L$$, :'st_novo'), '42501', null, 'agent: update is_won => 42501 (grant revogado)');
select tests.authenticate_as(:'uadmin');
select throws_ok(format($$update public.pipeline_stages set position = 99 where id = %L$$, :'st_novo'), '42501', null, 'admin: update position direto => 42501');
select throws_ok(format($$insert into public.pipeline_stages (organization_id, pipeline_id, name, position) values (%L, %L, 'Z', 50)$$, :'org_a', :'pipe'),
  '42501', null, 'admin: insert direto => 42501');
select throws_ok(format($$delete from public.pipeline_stages where id = %L$$, :'st_novo'), '42501', null, 'admin: delete direto => 42501');

select tests.authenticate_as(:'ub');
select throws_ok(format($$select public.create_stage(%L, 'X')$$, :'pipe'), '42501', null, 'admin de outra org: create_stage => 42501');
select throws_ok(format($$select public.set_stage_outcome(%L, 'won')$$, :'st_novo'), '42501', null, 'admin de outra org: set_stage_outcome => 42501');
select tests.clear_authentication();
select is((select count(*)::int from public.pipeline_stages where pipeline_id = :'pipe'), 7, 'nenhuma alteração cross-org');

select * from finish();
rollback;
