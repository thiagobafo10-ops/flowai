begin;
create extension if not exists pgtap with schema extensions;
select plan(79);
select tests.create_user('owner39@t.test','Owner39') as ua \gset
select tests.create_user('admin39@t.test','Admin39') as uadm \gset
select tests.create_user('agent39@t.test','Agent39') as uag \gset
select tests.create_user('viewer39@t.test','Viewer39') as uv \gset
select tests.create_user('owner39b@t.test','Owner39B') as ub \gset
select tests.create_org(:'ua','Org39A') as oa \gset
select tests.create_org(:'ub','Org39B') as ob \gset
select tests.add_member(:'oa',:'uadm','admin');
select tests.add_member(:'oa',:'uag','agent');
select tests.add_member(:'oa',:'uv','viewer');

-- graph helpers
create function pg_temp.graph(p_n2 text default 'end') returns jsonb language sql as $$
  select jsonb_build_object(
    'nodes', jsonb_build_array(
      jsonb_build_object('id','00000000-0000-0000-0000-0000000039a1','type','trigger','config','{}'::jsonb,'position','{"x":0,"y":0}'::jsonb),
      jsonb_build_object('id','00000000-0000-0000-0000-0000000039a2','type',p_n2,'config','{"text":"oi"}'::jsonb,'position','{"x":10,"y":20}'::jsonb)),
    'edges', jsonb_build_array(
      jsonb_build_object('id','00000000-0000-0000-0000-0000000039e1','source','00000000-0000-0000-0000-0000000039a1',
        'target','00000000-0000-0000-0000-0000000039a2','sourceHandle','default'))) $$;

-- schema
select ok('instagram_comment' = any (enum_range(null::public.automation_trigger_type)::text[]), 'enum instagram_comment');
select ok('instagram_story' = any (enum_range(null::public.automation_trigger_type)::text[]), 'enum instagram_story');
select ok('handoff_ai' = any (enum_range(null::public.automation_node_type)::text[]), 'enum handoff_ai');
select ok('handoff_human' = any (enum_range(null::public.automation_node_type)::text[]), 'enum handoff_human');
select has_table('public','automation_versions','automation_versions existe');
select has_column('public','automation_runs','claim_token','runs.claim_token');
select has_column('public','automation_run_steps','handle','steps.handle');
select has_column('public','conversations','automation_run_id','conversations.automation_run_id');
select has_column('public','instagram_send_intents','message_payload','intents.message_payload');
select has_column('public','instagram_send_intents','automation_run_id','intents.automation_run_id');
select is((select count(*)::int from private.automation_secrets),1,'segredo de payload registrado');
select is((select length(decrypted_secret) from vault.decrypted_secrets s join private.automation_secrets a on a.payload_secret_id=s.id),64,'segredo tem 32 bytes em hex');
select ok(not has_table_privilege('authenticated','private.automation_secrets','select'),'authenticated não lê automation_secrets');
select ok(not has_column_privilege('authenticated','public.conversations','automation_run_id','update'),'authenticated não atualiza automation_run_id');
select ok(not has_column_privilege('authenticated','public.conversations','automation_run_id','insert'),'authenticated não insere automation_run_id');
select ok(has_column_privilege('authenticated','public.conversations','automation_run_id','select'),'authenticated lê automation_run_id');
select ok(not has_function_privilege('anon','public.save_automation(uuid,uuid,text,public.automation_trigger_type,jsonb,jsonb)','execute'),'anon não executa save_automation');

-- fixtures para a automação de B e canal/conversa de A
insert into public.automations (id, organization_id, name, trigger_type) values
  ('00000000-0000-0000-0000-0000000039b1', :'ob', 'Auto B', 'contact_created');
insert into public.channels(id,organization_id,type,name) values ('00000000-0000-0000-0000-000000003901',:'oa','whatsapp','WA39');
insert into public.contacts(id,organization_id,name) values ('00000000-0000-0000-0000-000000003911',:'oa','C39');
insert into public.conversations(id,organization_id,contact_id,channel_id) values
  ('00000000-0000-0000-0000-000000003921',:'oa','00000000-0000-0000-0000-000000003911','00000000-0000-0000-0000-000000003901');

-- handle check (como postgres)
insert into public.automations (id, organization_id, name, trigger_type) values
  ('00000000-0000-0000-0000-0000000039c1', :'oa', 'Handles', 'message_received');
insert into public.automation_nodes (id, organization_id, automation_id, type) values
  ('00000000-0000-0000-0000-0000000039c2', :'oa', '00000000-0000-0000-0000-0000000039c1', 'trigger'),
  ('00000000-0000-0000-0000-0000000039c3', :'oa', '00000000-0000-0000-0000-0000000039c1', 'end');
select lives_ok(format($$insert into public.automation_edges(organization_id,automation_id,source_node_id,target_node_id,source_handle) values (%L,'00000000-0000-0000-0000-0000000039c1','00000000-0000-0000-0000-0000000039c2','00000000-0000-0000-0000-0000000039c3','opt:a1')$$, :'oa'),'handle opt:a1 aceito');
select throws_ok(format($$insert into public.automation_edges(organization_id,automation_id,source_node_id,target_node_id,source_handle) values (%L,'00000000-0000-0000-0000-0000000039c1','00000000-0000-0000-0000-0000000039c2','00000000-0000-0000-0000-0000000039c3','opt:A')$$, :'oa'),'23514',null,'handle opt:A rejeitado');
select lives_ok(format($$insert into public.automation_edges(organization_id,automation_id,source_node_id,target_node_id,source_handle) values (%L,'00000000-0000-0000-0000-0000000039c1','00000000-0000-0000-0000-0000000039c2','00000000-0000-0000-0000-0000000039c3','no_reply')$$, :'oa'),'handle no_reply aceito');

-- permissões de papel
select tests.authenticate_as(:'uag');
select throws_ok(format($$select public.save_automation(%L,null,'X','message_received','{}',%L)$$, :'oa', pg_temp.graph()),'42501',null,'agent não salva');
select tests.authenticate_as(:'uv');
select throws_ok(format($$select public.save_automation(%L,null,'X','message_received','{}',%L)$$, :'oa', pg_temp.graph()),'42501',null,'viewer não salva');
select throws_ok($$select public.activate_automation('00000000-0000-0000-0000-0000000039c1')$$,'42501',null,'viewer não ativa');
select tests.authenticate_as(:'uag');
select throws_ok($$select public.delete_automation('00000000-0000-0000-0000-0000000039c1')$$,'42501',null,'agent não exclui');
select throws_ok($$select public.duplicate_automation('00000000-0000-0000-0000-0000000039c1')$$,'42501',null,'agent não duplica');

-- admin salva
select tests.authenticate_as(:'uadm');
select throws_ok(format($$select public.save_automation(%L,null,'X','message_received','{}',%L)$$, :'ob', pg_temp.graph()),'42501',null,'admin de A não salva em B');
select throws_ok(format($$select public.save_automation(%L,'00000000-0000-0000-0000-0000000039b1','X','message_received','{}',%L)$$, :'oa', pg_temp.graph()),'P0002',null,'id de outra org: P0002');
select throws_ok(format($$select public.save_automation(%L,null,'','message_received','{}',%L)$$, :'oa', pg_temp.graph()),'22023',null,'nome vazio rejeitado');
select throws_ok(format($$select public.save_automation(%L,null,%L,'message_received','{}',%L)$$, :'oa', repeat('x',101), pg_temp.graph()),'22023',null,'nome > 100 rejeitado');
select throws_ok(format($$select public.save_automation(%L,null,'X','message_received','{}',%L)$$, :'oa', pg_temp.graph('foo')),'22023',null,'tipo de node desconhecido rejeitado');
select throws_ok(format($$select public.save_automation(%L,null,'X','message_received','{}',%L)$$, :'oa',
  jsonb_set(pg_temp.graph(), '{nodes,0,id}', '"abc"')),'22023',null,'id de node não-UUID rejeitado');
select throws_ok(format($$select public.save_automation(%L,null,'X','message_received','{}',%L)$$, :'oa',
  jsonb_set(pg_temp.graph(), '{edges,0,target}', '"00000000-0000-0000-0000-0000000039ff"')),'22023',null,'aresta para node inexistente rejeitada');

select tests.authenticate_as(:'uadm');
select lives_ok(format($$select public.save_automation(%L,null,'Boas-vindas','message_received','{"k":1}',%L)$$, :'oa', pg_temp.graph('message')),'admin salva automação nova');
select tests.clear_authentication();
select is((select count(*)::int from public.automations where name='Boas-vindas' and organization_id=:'oa'),1,'automação criada');
select is((select count(*)::int from public.automation_nodes where id in ('00000000-0000-0000-0000-0000000039a1','00000000-0000-0000-0000-0000000039a2')),2,'nodes criados com ids do cliente');
select is((select count(*)::int from public.automation_edges where id='00000000-0000-0000-0000-0000000039e1'),1,'aresta criada');
select is((select trigger_config::text from public.automations where name='Boas-vindas' and organization_id=:'oa'),'{"k": 1}','trigger_config salvo');
select is((select count(*)::int from public.automation_versions v join public.automations a on a.id=v.automation_id where a.name='Boas-vindas'),0,'rascunho não cria versão');
select id as aid from public.automations where name='Boas-vindas' and organization_id=:'oa' \gset

-- ativar
select tests.authenticate_as(:'uadm');
select is(public.activate_automation(:'aid'),1,'ativar retorna versão 1');
select tests.clear_authentication();
select is((select (status, current_version, activated_at is not null)::text from public.automations where id=:'aid'),'(active,1,t)','ativa com activated_at');
select is((select jsonb_array_length(graph->'nodes') from public.automation_versions where automation_id=:'aid' and version=1),2,'versão 1 tem 2 nodes');

-- salvar ativa => versão 2, versão 1 intacta
select tests.authenticate_as(:'uadm');
select lives_ok(format($$select public.save_automation(%L,%L,'Boas-vindas v2','message_received','{}',%L)$$, :'oa', :'aid', pg_temp.graph('end')),'salvar ativa');
select tests.clear_authentication();
select is((select current_version from public.automations where id=:'aid'),2,'versão corrente 2');
select is((select graph #>> '{nodes,1,type}' from public.automation_versions where automation_id=:'aid' and version=1),'message','versão 1 intacta');
select is((select graph #>> '{nodes,1,type}' from public.automation_versions where automation_id=:'aid' and version=2),'end','versão 2 reflete o novo grafo');

-- pausar
select tests.authenticate_as(:'uadm');
select lives_ok(format($$select public.pause_automation(%L)$$, :'aid'),'pausar');
select tests.clear_authentication();
select is((select status::text from public.automations where id=:'aid'),'paused','status paused');

-- duplicar
select tests.authenticate_as(:'uadm');
select public.duplicate_automation(:'aid') as dup \gset
select tests.clear_authentication();
select is((select (name, status, current_version)::text from public.automations where id=:'dup'),'("Cópia de Boas-vindas v2",draft,0)','duplicata é rascunho');
select is((select count(*)::int from public.automation_nodes where automation_id=:'dup' and id not in ('00000000-0000-0000-0000-0000000039a1','00000000-0000-0000-0000-0000000039a2')),2,'duplicata tem nodes com novos ids');
select is((select count(*)::int from public.automation_edges where automation_id=:'dup'),1,'duplicata tem a aresta');

-- membros leem versões; escrita direta negada
select tests.authenticate_as(:'uv');
select is((select count(*)::int from public.automation_versions),2,'viewer lê versões da própria org');
select throws_ok(format($$insert into public.automation_nodes(organization_id,automation_id,type) values (%L,%L,'end')$$, :'oa', :'aid'),'42501',null,'authenticated não insere node');
select tests.authenticate_as(:'uadm');
select throws_ok(format($$insert into public.automations(organization_id,name,trigger_type) values (%L,'Z','message_received')$$, :'oa'),'42501',null,'admin não insere automação direto');
select throws_ok($$update public.automations set name='Hack' where id='00000000-0000-0000-0000-0000000039c1'$$,'42501',null,'admin não atualiza automação direto');
select throws_ok($$delete from public.automation_edges$$,'42501',null,'admin não apaga arestas direto');
select throws_ok(format($$insert into public.automation_runs(organization_id,automation_id,trigger_event_id) values (%L,%L,gen_random_uuid())$$, :'oa', :'aid'),'42501',null,'authenticated não insere runs');
select throws_ok(format($$insert into public.automation_run_steps(organization_id,run_id,node_id,status) values (%L,gen_random_uuid(),'00000000-0000-0000-0000-0000000039a1','completed')$$, :'oa'),'42501',null,'authenticated não insere steps');
select throws_ok(format($$update public.conversations set automation_run_id=gen_random_uuid() where organization_id=%L$$, :'oa'),'42501',null,'authenticated não grava automation_run_id');

-- excluir cancela runs e limpa a conversa
select tests.clear_authentication();
insert into public.events (id, organization_id, type, actor_type) values ('00000000-0000-0000-0000-0000000039f1', :'oa', 'x', 'system');
insert into public.automation_runs (id, organization_id, automation_id, trigger_event_id, conversation_id, status, waiting_for, resume_at)
  values ('00000000-0000-0000-0000-0000000039d1', :'oa', :'aid', '00000000-0000-0000-0000-0000000039f1',
    '00000000-0000-0000-0000-000000003921', 'waiting', 'delay', now() + interval '1 hour');
update public.conversations set automation_run_id='00000000-0000-0000-0000-0000000039d1' where id='00000000-0000-0000-0000-000000003921';
select tests.authenticate_as(:'uadm');
select lives_ok(format($$select public.delete_automation(%L)$$, :'aid'),'admin exclui');
select tests.clear_authentication();
select is((select automation_run_id from public.conversations where id='00000000-0000-0000-0000-000000003921'),null,'conversa liberada da automação');
select is((select count(*)::int from public.automation_runs where id='00000000-0000-0000-0000-0000000039d1'),0,'runs removidos com a automação');


-- execuções em andamento sobrevivem à edição (nodes viram ids do grafo da versão)
select tests.authenticate_as(:'uadm');
select public.save_automation(:'oa', null, 'Run', 'message_received', '{}', pg_temp.graph()) as rid \gset
select is(public.activate_automation(:'rid'),1,'ativa automação do run (v1)');
select tests.clear_authentication();
insert into public.events (id, organization_id, type, actor_type) values ('00000000-0000-0000-0000-0000000039f2', :'oa', 'x', 'system');
select lives_ok(format($$insert into public.automation_runs (id, organization_id, automation_id, trigger_event_id, version, status, waiting_for, current_node_id)
  values ('00000000-0000-0000-0000-0000000039d2', %L, %L, '00000000-0000-0000-0000-0000000039f2', 1, 'waiting', 'reply', '00000000-0000-0000-0000-0000000039a2')$$, :'oa', :'rid'),'run v1 esperando no node X');
select lives_ok(format($$insert into public.automation_run_steps (organization_id, run_id, node_id, status) values (%L, '00000000-0000-0000-0000-0000000039d2', '00000000-0000-0000-0000-0000000039a1', 'completed')$$, :'oa'),'step do trigger');
select tests.authenticate_as(:'uadm');
select lives_ok(format($$select public.save_automation(%L,%L,'Run','message_received','{}',%L)$$, :'oa', :'rid',
  jsonb_build_object('nodes', jsonb_build_array(pg_temp.graph()->'nodes'->0), 'edges', '[]'::jsonb)),'v2 sem o node X');
select tests.clear_authentication();
select is((select current_node_id from public.automation_runs where id='00000000-0000-0000-0000-0000000039d2'),'00000000-0000-0000-0000-0000000039a2'::uuid,'current_node_id do run preservado');
select is((select count(*)::int from public.automation_run_steps where run_id='00000000-0000-0000-0000-0000000039d2'),1,'steps preservados');
select lives_ok(format($$insert into public.automation_run_steps (organization_id, run_id, node_id, status) values (%L, '00000000-0000-0000-0000-0000000039d2', '00000000-0000-0000-0000-0000000039a2', 'completed')$$, :'oa'),'step para node removido ainda insere');
select throws_ok(format($$insert into public.automation_runs (organization_id, automation_id, trigger_event_id, version) values (%L, %L, gen_random_uuid(), 99)$$, :'oa', :'rid'),'23503',null,'run exige versão existente');

-- ids de outra organização, papéis e idempotência
select tests.authenticate_as(:'uadm');
select throws_ok($$select public.activate_automation('00000000-0000-0000-0000-0000000039b1')$$,'P0002',null,'activate de outra org: P0002');
select throws_ok($$select public.pause_automation('00000000-0000-0000-0000-0000000039b1')$$,'P0002',null,'pause de outra org: P0002');
select throws_ok($$select public.delete_automation('00000000-0000-0000-0000-0000000039b1')$$,'P0002',null,'delete de outra org: P0002');
select throws_ok($$select public.duplicate_automation('00000000-0000-0000-0000-0000000039b1')$$,'P0002',null,'duplicate de outra org: P0002');
select throws_ok(format($$select public.save_automation(%L,null,'Y','message_received','{}',%L)$$, :'oa', pg_temp.graph()),'22023',null,'node id de outra automação rejeitado');
select throws_ok(format($$select public.save_automation(%L,%L,'Run','message_received','{}',%L)$$, :'oa', :'rid',
  jsonb_set(pg_temp.graph(), '{edges}', jsonb_build_array(pg_temp.graph()#>'{edges,0}', pg_temp.graph()#>'{edges,0}'))),'22023',null,'ids de aresta duplicados rejeitados');
select is(public.activate_automation(:'rid'),2,'ativar já ativa é idempotente');
select is((select count(*)::int from public.automation_versions where automation_id=:'rid'),2,'sem versão extra');
select tests.authenticate_as(:'uag');
select throws_ok(format($$select public.pause_automation(%L)$$, :'rid'),'42501',null,'agent não pausa');
select tests.authenticate_as(:'uadm');
select public.pause_automation(:'rid');
select public.save_automation(:'oa', :'rid', 'Run', 'message_received', '{}', pg_temp.graph());
select is(public.activate_automation(:'rid'),3,'pausada -> salvar -> ativar cria nova versão');
select tests.clear_authentication();
select * from finish();
rollback;
