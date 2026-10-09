begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

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
insert into public.events (id, organization_id, type, contact_id, actor_type) values
  ('00000000-0000-0000-0000-0000000000e1', :'org_a', 'contact_created', '00000000-0000-0000-0000-0000000000c1', 'system'),
  ('00000000-0000-0000-0000-0000000000e2', :'org_b', 'contact_created', '00000000-0000-0000-0000-0000000000c2', 'system');
insert into public.automations (id, organization_id, name, trigger_type) values
  ('00000000-0000-0000-0000-0000000000a2', :'org_b', 'Auto B', 'contact_created');
insert into public.automation_nodes (id, organization_id, automation_id, type) values
  ('00000000-0000-0000-0000-0000000000b9', :'org_b', '00000000-0000-0000-0000-0000000000a2', 'trigger');
insert into public.automation_runs (id, organization_id, automation_id, trigger_event_id, contact_id) values
  ('00000000-0000-0000-0000-0000000000d2', :'org_b', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c2');

-- defaults
select is((select (status, created_by_ai)::text from public.automations where id = '00000000-0000-0000-0000-0000000000a2'),
  '(draft,f)', 'defaults da automação');
select is((select config::text || position::text from public.automation_nodes where id = '00000000-0000-0000-0000-0000000000b9'),
  '{}{"x": 0, "y": 0}', 'defaults do node');
select is((select (status, step_count)::text from public.automation_runs where id = '00000000-0000-0000-0000-0000000000d2'),
  '(pending,0)', 'defaults do run');

-- automations: admin+ escreve
select tests.authenticate_as(:'uagent');
select throws_ok(format($$insert into public.automations(organization_id, name, trigger_type) values (%L, 'X', 'message_received')$$, :'org_a'), '42501', null, 'agent não cria automação');
select tests.authenticate_as(:'uadmin');
select lives_ok(format($$insert into public.automations(id, organization_id, name, trigger_type) values ('00000000-0000-0000-0000-0000000000a1', %L, 'Boas-vindas', 'message_received')$$, :'org_a'), 'admin cria automação');
select lives_ok(format($$insert into public.automation_nodes(id, organization_id, automation_id, type) values ('00000000-0000-0000-0000-0000000000b1', %1$L, '00000000-0000-0000-0000-0000000000a1', 'trigger'), ('00000000-0000-0000-0000-0000000000b2', %1$L, '00000000-0000-0000-0000-0000000000a1', 'end')$$, :'org_a'), 'admin cria 2 nodes');
select lives_ok(format($$insert into public.automation_edges(id, organization_id, automation_id, source_node_id, target_node_id) values ('00000000-0000-0000-0000-0000000000f1', %L, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2')$$, :'org_a'), 'admin cria edge');
select is((select source_handle from public.automation_edges where id = '00000000-0000-0000-0000-0000000000f1'), 'default', 'source_handle default');
select throws_ok(format($$insert into public.automation_edges(organization_id, automation_id, source_node_id, target_node_id, source_handle) values (%L, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'maybe')$$, :'org_a'), '23514', null, 'source_handle inválido');
select lives_ok($$update public.automations set status = 'active', name = 'Boas-vindas 2' where id = '00000000-0000-0000-0000-0000000000a1'$$, 'admin atualiza automação');
select throws_ok($$update public.automations set created_by_ai = true where id = '00000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'created_by_ai não editável');
select lives_ok($$update public.automation_nodes set config = '{"text":"oi"}', position = '{"x":10,"y":20}' where id = '00000000-0000-0000-0000-0000000000b1'$$, 'admin atualiza node');
select throws_ok($$update public.automation_nodes set automation_id = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 'automation_id do node imutável');
select throws_ok($$update public.automation_edges set source_handle = 'true' where id = '00000000-0000-0000-0000-0000000000f1'$$, '42501', null, 'edges sem update');

-- edge entre automações diferentes
select tests.clear_authentication();
insert into public.automations (id, organization_id, name, trigger_type) values
  ('00000000-0000-0000-0000-0000000000a3', :'org_a', 'Outra', 'tag_added');
insert into public.automation_nodes (id, organization_id, automation_id, type) values
  ('00000000-0000-0000-0000-0000000000b3', :'org_a', '00000000-0000-0000-0000-0000000000a3', 'trigger');
select throws_ok(format($$insert into public.automation_edges(organization_id, automation_id, source_node_id, target_node_id) values (%L, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b3')$$, :'org_a'), '23503', null, 'edge entre automações diferentes falha');

-- leitura / isolamento
select tests.authenticate_as(:'uview');
select is((select count(*)::int from public.automations), 2, 'viewer lê automações da própria org');
select is((select count(*)::int from public.automation_nodes where automation_id = '00000000-0000-0000-0000-0000000000a1'), 2, 'viewer lê nodes');
select is((select count(*)::int from public.automations where organization_id = :'org_b'), 0, 'A não vê automações de B');
select is((select count(*)::int from public.automation_runs), 0, 'A não vê runs de B');
select is((select count(*)::int from public.events where organization_id = :'org_b'), 0, 'A não vê events de B');
select is((select count(*)::int from public.events where id = '00000000-0000-0000-0000-0000000000e1'), 1, 'membro lê events da org');
select tests.authenticate_as(:'uagent');
update public.automations set name = 'Hack' where id = '00000000-0000-0000-0000-0000000000a1';
delete from public.automation_nodes where id = '00000000-0000-0000-0000-0000000000b1';
select tests.clear_authentication();
select is((select name from public.automations where id = '00000000-0000-0000-0000-0000000000a1'), 'Boas-vindas 2', 'agent não altera automação');
select is((select count(*)::int from public.automation_nodes where id = '00000000-0000-0000-0000-0000000000b1'), 1, 'agent não apaga node');

-- runs: sem escrita para authenticated
select tests.authenticate_as(:'ua');
select throws_ok(format($$insert into public.automation_runs(organization_id, automation_id, trigger_event_id) values (%L, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1')$$, :'org_a'), '42501', null, 'owner não insere runs');
select throws_ok(format($$insert into public.automation_run_steps(organization_id, run_id, node_id, status) values (%L, gen_random_uuid(), '00000000-0000-0000-0000-0000000000b1', 'completed')$$, :'org_a'), '42501', null, 'owner não insere steps');

-- runs como postgres
select tests.clear_authentication();
select lives_ok(format($$insert into public.automation_runs(id, organization_id, automation_id, trigger_event_id, contact_id) values ('00000000-0000-0000-0000-0000000000d1', %L, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1')$$, :'org_a'), 'service cria run');
select throws_ok(format($$insert into public.automation_runs(organization_id, automation_id, trigger_event_id) values (%L, '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1')$$, :'org_a'), '23505', null, 'run duplicado (automation, evento) falha');
select throws_ok(format($$insert into public.automation_runs(organization_id, automation_id, trigger_event_id, current_node_id) values (%L, '00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1')$$, :'org_a'), '23503', null, 'current_node_id de outra automação falha');
select lives_ok(format($$insert into public.automation_run_steps(organization_id, run_id, node_id, status) values (%L, '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'completed')$$, :'org_a'), 'service cria step');
select throws_ok(format($$insert into public.automation_run_steps(organization_id, run_id, node_id, status) values (%L, '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'completed')$$, :'org_a'), '23505', null, 'step duplicado (run, node, iteration) falha');
select tests.authenticate_as(:'uview');
select is((select count(*)::int from public.automation_run_steps), 1, 'membro lê steps da org');
select tests.clear_authentication();

-- events: só código definer do banco insere (API não insere, nem como o próprio usuário)
select tests.authenticate_as(:'uagent');
select throws_ok(format($$insert into public.events(organization_id, type, actor_type, actor_id, contact_id, payload) values (%L, 'note_added', 'user', %L, '00000000-0000-0000-0000-0000000000c1', '{"a":1}')$$, :'org_a', :'uagent'), '42501', null, 'agent não insere event (nem com actor_id próprio)');
select throws_ok(format($$insert into public.events(organization_id, type, actor_type, actor_id) values (%L, 'x', 'ai', %L)$$, :'org_a', :'uagent'), '42501', null, 'agent não insere event actor_type ai');
select throws_ok(format($$insert into public.events(organization_id, type, actor_type, actor_id) values (%L, 'x', 'user', %L)$$, :'org_a', :'uadmin'), '42501', null, 'agent não forja actor_id');
select throws_ok($$update public.events set type = 'hack' where id = '00000000-0000-0000-0000-0000000000e1'$$, '42501', null, 'events sem update');
select throws_ok($$delete from public.events where id = '00000000-0000-0000-0000-0000000000e1'$$, '42501', null, 'events sem delete');
select tests.authenticate_as(:'uview');
select throws_ok(format($$insert into public.events(organization_id, type, actor_type, actor_id) values (%L, 'x', 'user', %L)$$, :'org_a', :'uview'), '42501', null, 'viewer não insere event');
select tests.clear_authentication();
select is((select type from public.events where id = '00000000-0000-0000-0000-0000000000e1'), 'contact_created', 'events sem update/delete');

select * from finish();
rollback;
