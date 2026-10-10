begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

select tests.create_user('a@t.test') as ua \gset
select tests.create_user('b@t.test') as ub \gset
select tests.create_user('view@t.test') as uview \gset
select tests.create_user('agent@t.test') as uagent \gset
select tests.create_user('admin@t.test') as uadmin \gset
select tests.create_org(:'ua', 'Org A') as org_a \gset
select tests.create_org(:'ub', 'Org B') as org_b \gset
select tests.add_member(:'org_a', :'uview', 'viewer');
select tests.add_member(:'org_a', :'uagent', 'agent');
select tests.add_member(:'org_a', :'uadmin', 'admin');

-- fixtures (postgres)
insert into public.contacts (id, organization_id, name) values
  ('00000000-0000-0000-0000-0000000000c1', :'org_a', 'Contato A'),
  ('00000000-0000-0000-0000-0000000000c2', :'org_b', 'Contato B');
insert into public.pipelines (id, organization_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', :'org_a', 'Pipe A'),
  ('00000000-0000-0000-0000-0000000000a2', :'org_a', 'Pipe A2'),
  ('00000000-0000-0000-0000-0000000000b1', :'org_b', 'Pipe B');
insert into public.pipeline_stages (id, organization_id, pipeline_id, name, position) values
  ('00000000-0000-0000-0000-0000000000e1', :'org_a', '00000000-0000-0000-0000-0000000000a1', 'S1', 0),
  ('00000000-0000-0000-0000-0000000000e2', :'org_a', '00000000-0000-0000-0000-0000000000a2', 'S2', 0),
  ('00000000-0000-0000-0000-0000000000e3', :'org_b', '00000000-0000-0000-0000-0000000000b1', 'SB', 0);
-- etapas finais: o status do deal agora segue a etapa (gatilho da Fase 2)
insert into public.pipeline_stages (id, organization_id, pipeline_id, name, position, is_won, is_lost) values
  ('00000000-0000-0000-0000-0000000000e4', :'org_a', '00000000-0000-0000-0000-0000000000a1', 'SW', 5, true, false),
  ('00000000-0000-0000-0000-0000000000e5', :'org_a', '00000000-0000-0000-0000-0000000000a1', 'SL', 6, false, true);
insert into public.tags (id, organization_id, name) values
  ('00000000-0000-0000-0000-0000000000f1', :'org_a', 'VIP');

-- isolamento
select tests.authenticate_as(:'ua');
select is((select count(*)::int from public.contacts), 1, 'A vê só contatos de A');
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.contacts where id = '00000000-0000-0000-0000-0000000000c1'), 0, 'B não vê contato de A');

-- agent+ escreve contatos, viewer não
select tests.authenticate_as(:'uagent');
select lives_ok(format($$insert into public.contacts(organization_id, name) values (%L, 'Novo')$$, :'org_a'), 'agent insere contato');
select tests.authenticate_as(:'uview');
select throws_ok(format($$insert into public.contacts(organization_id, name) values (%L, 'X')$$, :'org_a'),
  '42501', null, 'viewer não insere contato');
select is((select count(*)::int from public.contacts), 2, 'viewer lê contatos');

-- pipelines: só admin+
select tests.authenticate_as(:'uagent');
select throws_ok(format($$insert into public.pipelines(organization_id, name) values (%L, 'P')$$, :'org_a'),
  '42501', null, 'agent não insere pipeline');
select tests.authenticate_as(:'uadmin');
select throws_ok(format($$insert into public.pipelines(organization_id, name) values (%L, 'P')$$, :'org_a'),
  '42501', null, 'admin não insere pipeline direto (grant revogado em 20261010000004)');
select throws_ok(format($$insert into public.pipeline_stages(organization_id, pipeline_id, name, position) values (%L, '00000000-0000-0000-0000-0000000000a1', 'S9', 9)$$, :'org_a'),
  '42501', null, 'admin não insere stage direto (use create_stage; grant revogado)');
select tests.clear_authentication();
insert into public.pipeline_stages(organization_id, pipeline_id, name, position) values (:'org_a', '00000000-0000-0000-0000-0000000000a1', 'S9', 9); -- fixture como postgres
select tests.authenticate_as(:'uagent');
select throws_ok(format($$insert into public.pipeline_stages(organization_id, pipeline_id, name, position) values (%L, '00000000-0000-0000-0000-0000000000a1', 'S8', 8)$$, :'org_a'),
  '42501', null, 'agent não insere stage');

-- cross-tenant insert
select tests.authenticate_as(:'ub');
select throws_ok(format($$insert into public.contacts(organization_id, name) values (%L, 'X')$$, :'org_a'),
  '42501', null, 'B não insere contato em A');

-- FKs compostas / unicidade (postgres)
select tests.clear_authentication();
select throws_ok(format($$insert into public.deals(organization_id, contact_id, pipeline_id, stage_id, title)
  values (%L, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e3', 'x')$$, :'org_b'),
  '23503', null, 'deal cross-tenant (contato de A em B) rejeitado');
select throws_ok(format($$insert into public.deals(organization_id, contact_id, pipeline_id, stage_id, title)
  values (%L, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', 'x')$$, :'org_a'),
  '23503', null, 'stage de outro pipeline da mesma org rejeitado');
insert into public.deals (id, organization_id, contact_id, pipeline_id, stage_id, title)
  values ('00000000-0000-0000-0000-0000000000d1', :'org_a', '00000000-0000-0000-0000-0000000000c1',
          '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'Deal 1');
select throws_ok(format($$insert into public.deals(organization_id, contact_id, pipeline_id, stage_id, title)
  values (%L, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'Deal 2')$$, :'org_a'),
  '23505', null, 'segundo deal open para (contato, pipeline) rejeitado');
select lives_ok(format($$insert into public.deals(organization_id, contact_id, pipeline_id, stage_id, title, status)
  values (%L, '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', 'Deal 3', 'won')$$, :'org_a'),
  'deal não-open adicional permitido');

-- lead_score
select throws_ok($$update public.contacts set lead_score = 101$$, '23514', null, 'lead_score > 100 rejeitado');

-- unicidade parcial
select lives_ok(format($$insert into public.contacts(organization_id, name) values (%L, 'sem wa 1'), (%L, 'sem wa 2')$$, :'org_a', :'org_a'), 'whatsapp_id nulo repetido ok');
insert into public.contacts (organization_id, name, whatsapp_id) values (:'org_a', 'W', '5511');
select throws_ok(format($$insert into public.contacts(organization_id, name, whatsapp_id) values (%L, 'W2', '5511')$$, :'org_a'),
  '23505', null, 'whatsapp_id duplicado na org rejeitado');
select lives_ok(format($$insert into public.contacts(organization_id, name, whatsapp_id) values (%L, 'W3', '5511')$$, :'org_b'), 'mesmo whatsapp_id em outra org ok');

-- tags: unique case-insensitive
select throws_ok(format($$insert into public.tags(organization_id, name) values (%L, 'vip')$$, :'org_a'),
  '23505', null, 'tag duplicada case-insensitive rejeitada');

-- pipeline default único
update public.pipelines set is_default = true where id = '00000000-0000-0000-0000-0000000000a1';
select throws_ok($$update public.pipelines set is_default = true where id = '00000000-0000-0000-0000-0000000000a2'$$,
  '23505', null, 'só um pipeline default por org');

-- contact_tags / custom fields
insert into public.contact_tags (organization_id, contact_id, tag_id)
  values (:'org_a', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1');
insert into public.contact_custom_fields (organization_id, contact_id, key, value)
  values (:'org_a', '00000000-0000-0000-0000-0000000000c1', 'cidade', 'SP');
select throws_ok(format($$insert into public.contact_tags(organization_id, contact_id, tag_id)
  values (%L, '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000f1')$$, :'org_b'),
  '23503', null, 'contact_tags cross-tenant rejeitado');

-- viewer não remove contact_tags; agent remove
select tests.authenticate_as(:'uview');
delete from public.contact_tags;
select tests.clear_authentication();
select is((select count(*)::int from public.contact_tags), 1, 'viewer não remove contact_tags');
select tests.authenticate_as(:'uagent');
delete from public.contact_tags;
delete from public.contact_custom_fields;
select tests.clear_authentication();
select is((select count(*)::int from public.contact_tags) + (select count(*)::int from public.contact_custom_fields), 0, 'agent remove contact_tags e custom fields');

-- delete contato: agent não, admin sim (cascade para deals)
select tests.authenticate_as(:'uagent');
delete from public.contacts where id = '00000000-0000-0000-0000-0000000000c1';
select tests.clear_authentication();
select is((select count(*)::int from public.contacts where id = '00000000-0000-0000-0000-0000000000c1'), 1, 'agent não deleta contato');
select tests.authenticate_as(:'uadmin');
delete from public.contacts where id = '00000000-0000-0000-0000-0000000000c1';
select tests.clear_authentication();
select is((select count(*)::int from public.contacts where id = '00000000-0000-0000-0000-0000000000c1')
        + (select count(*)::int from public.deals where contact_id = '00000000-0000-0000-0000-0000000000c1'), 0, 'admin deleta contato e deals em cascata');

-- stage com deals não pode ser deletada; pipeline cascade para stages
insert into public.contacts (id, organization_id, name) values ('00000000-0000-0000-0000-0000000000c3', :'org_a', 'C3');
insert into public.deals (organization_id, contact_id, pipeline_id, stage_id, title)
  values (:'org_a', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'D');
select throws_ok($$delete from public.pipeline_stages where id = '00000000-0000-0000-0000-0000000000e1'$$,
  '23503', null, 'stage com deals não pode ser deletada');
delete from public.pipelines where id = '00000000-0000-0000-0000-0000000000a2';
select is((select count(*)::int from public.pipeline_stages where pipeline_id = '00000000-0000-0000-0000-0000000000a2'), 0, 'deletar pipeline remove stages');

-- deals RLS: agent insere, viewer não
select tests.authenticate_as(:'uagent');
select lives_ok(format($$insert into public.deals(organization_id, contact_id, pipeline_id, stage_id, title, status)
  values (%L, '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e5', 'Ag', 'lost')$$, :'org_a'), 'agent insere deal');
select tests.authenticate_as(:'uview');
select throws_ok(format($$insert into public.deals(organization_id, contact_id, pipeline_id, stage_id, title, status)
  values (%L, '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e5', 'V', 'lost')$$, :'org_a'),
  '42501', null, 'viewer não insere deal');
-- assigned_to precisa ser membro da org
select tests.clear_authentication();
select throws_ok(format($$update public.contacts set assigned_to = %L where id = '00000000-0000-0000-0000-0000000000c3'$$, :'ub'),
  '23503', null, 'assigned_to fora da org rejeitado');
select tests.authenticate_as(:'uagent');
select lives_ok(format($$update public.contacts set assigned_to = %L where id = '00000000-0000-0000-0000-0000000000c3'$$, :'uadmin'),
  'assigned_to membro da org ok');

-- Fix round 1: reorder de stages (unique deferrable)
select tests.clear_authentication(); -- escrita direta de position revogada para authenticated; valida o unique deferrable como postgres
select lives_ok($q$do $$ begin
  update public.pipeline_stages set position = 9 where id = '00000000-0000-0000-0000-0000000000e1'; -- colide com S9
  update public.pipeline_stages set position = 0 where name = 'S9' and pipeline_id = '00000000-0000-0000-0000-0000000000a1';
  set constraints all immediate;
end $$$q$, 'unique deferrable de position permite troca de posições (como postgres)');
select tests.clear_authentication();
select is((select position from public.pipeline_stages where name = 'S9' and pipeline_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'S9 agora na posição 0');
select is((select position from public.pipeline_stages where name = 'S1' and pipeline_id = '00000000-0000-0000-0000-0000000000a1'), 9, 'S1 agora na posição 9');

-- agent move deal de stage no mesmo pipeline
select tests.authenticate_as(:'uagent');
select lives_ok($$update public.deals set stage_id = (select id from public.pipeline_stages where name = 'S9' and pipeline_id = '00000000-0000-0000-0000-0000000000a1') where title = 'D'$$, 'agent move deal de stage');
select tests.clear_authentication();
select is((select s.name from public.deals d join public.pipeline_stages s on s.id = d.stage_id where d.title = 'D'), 'S9', 'stage do deal alterado');

-- organization_id imutável
select tests.authenticate_as(:'uagent');
select throws_ok(format($$update public.contacts set organization_id = %L where id = '00000000-0000-0000-0000-0000000000c3'$$, :'org_b'),
  '42501', null, 'membro não troca organization_id do contato');

-- owner_id de outra org
select tests.clear_authentication();
select throws_ok(format($$insert into public.deals(organization_id, contact_id, pipeline_id, stage_id, title, status, owner_id)
  values (%L, '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', 'O', 'won', %L)$$, :'org_a', :'ub'),
  '23503', null, 'owner_id só de membro da org');

-- viewer update silencioso
select tests.authenticate_as(:'uview');
update public.contacts set name = 'x' where id = '00000000-0000-0000-0000-0000000000c3';
select tests.clear_authentication();
select isnt((select name from public.contacts where id = '00000000-0000-0000-0000-0000000000c3'), 'x', 'viewer não altera contato');

select * from finish();
rollback;
