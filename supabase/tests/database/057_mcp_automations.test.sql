begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select tests.create_user('owner57@t.test','Dona') as ua \gset
select tests.create_user('admin57@t.test','Adm') as uad \gset
select tests.create_user('agent57@t.test','Agente') as uag \gset
select tests.create_user('viewer57@t.test','Viewer') as uv \gset
select tests.create_user('owner57b@t.test','Outra') as ub \gset
select tests.create_org(:'ua','Org57A') as oa \gset
select tests.create_org(:'ub','Org57B') as ob \gset
select tests.add_member(:'oa',:'uad','admin');
select tests.add_member(:'oa',:'uag','agent');
select tests.add_member(:'oa',:'uv','viewer');

insert into public.channels(id,organization_id,type,name,status) values
  ('00000000-0000-0000-0000-000000005701',:'oa','simulator','Sim57','active');

-- grafo mínimo válido: trigger -> message (nós determinísticos por automação)
create function pg_temp.g(p_k text) returns jsonb language sql as $$
  select jsonb_build_object(
    'nodes', jsonb_build_array(
      jsonb_build_object('id', md5(p_k||'t')::uuid, 'type','trigger','config','{}'::jsonb,'position','{"x":0,"y":0}'::jsonb),
      jsonb_build_object('id', md5(p_k||'m')::uuid, 'type','message','config','{"mode":"text","text":"Oi"}'::jsonb,'position','{"x":0,"y":0}'::jsonb)),
    'edges', jsonb_build_array(jsonb_build_object('id', md5(p_k||'e')::uuid, 'source', md5(p_k||'t')::uuid,
      'target', md5(p_k||'m')::uuid, 'sourceHandle','default'))) $$;
create function pg_temp.ingest(p_ext text, p_sender text, p_text text, p_ctx jsonb default '{}') returns uuid language sql as $$
  select public.ingest_inbound_message('00000000-0000-0000-0000-000000005701', p_ext, p_sender, 'Cliente', p_text, now(), p_ctx) $$;
create function pg_temp.runs(p_auto uuid) returns int language sql as $$
  select count(*)::int from public.automation_runs where automation_id = p_auto $$;
-- conclui as execuções da automação (libera a conversa para a próxima mensagem)
create function pg_temp.finish(p_auto uuid, p_status public.run_status default 'completed') returns void language sql as $$
  update public.conversations set automation_run_id = null
    where automation_run_id in (select id from public.automation_runs where automation_id = p_auto);
  update public.automation_runs set status = p_status, claim_token = null, claimed_until = null
    where automation_id = p_auto and status in ('pending','running','waiting') $$;

-- =============================================================== estrutura
select has_column('public','automations','mcp_spec','coluna mcp_spec');
select col_is_null('public','automations','mcp_spec','mcp_spec é nulo para automações do painel');
select has_column('public','automations','mcp_spec_stale','coluna mcp_spec_stale');
select col_not_null('public','automations','mcp_spec_stale','mcp_spec_stale não nulo');
select col_default_is('public','automations','mcp_spec_stale','false','mcp_spec_stale padrão false');
select has_function('public','save_mcp_automation',
  array['uuid','uuid','text','jsonb','automation_trigger_type','jsonb','jsonb','boolean'],'save_mcp_automation existe');
select ok(has_function_privilege('authenticated',
  'public.save_mcp_automation(uuid,uuid,text,jsonb,public.automation_trigger_type,jsonb,jsonb,boolean)','execute'),
  'authenticated executa save_mcp_automation');
select ok(not has_function_privilege('anon',
  'public.save_mcp_automation(uuid,uuid,text,jsonb,public.automation_trigger_type,jsonb,jsonb,boolean)','execute'),
  'anon não executa save_mcp_automation');
select ok(not has_function_privilege('authenticated','private.automation_contact_already_ran(uuid,uuid)','execute'),
  'authenticated não executa o helper privado');

-- =============================================================== criar / permissões
select tests.authenticate_as(:'ua');
select public.save_mcp_automation(:'oa', null, 'Preço por DM', '{"gatilho":"dm","palavras":["preco"]}',
  'keyword_detected', '{"keywords":["preco"],"mode":"contains","oncePerUser":true}', pg_temp.g('dm')) as dm \gset
select is((select mcp_spec from public.automations where id=:'dm'),'{"gatilho":"dm","palavras":["preco"]}'::jsonb,'grava mcp_spec');
select is((select mcp_spec_stale from public.automations where id=:'dm'),false,'criada sem stale');
select is((select name from public.automations where id=:'dm'),'Preço por DM','nome salvo pelo caminho de save_automation');
select is((select count(*)::int from public.automation_nodes where automation_id=:'dm'),2,'grafo salvo');
select throws_ok($$select public.save_mcp_automation('$$||:'oa'||$$', null, '  ', '{}', 'keyword_detected',
  '{"keywords":["a"],"mode":"contains"}', pg_temp.g('x'))$$,'22023','invalid_name','mesmas validações de save_automation');
select throws_ok($$select public.save_mcp_automation('$$||:'oa'||$$', null, 'X', '[]', 'keyword_detected',
  '{"keywords":["a"],"mode":"contains"}', pg_temp.g('x'))$$,'22023','invalid_spec','spec precisa ser objeto');

select tests.authenticate_as(:'uad');
select lives_ok($$select public.save_mcp_automation('$$||:'oa'||$$', '$$||:'dm'||$$', 'Preço por DM', '{"gatilho":"dm","palavras":["preco"]}',
  'keyword_detected', '{"keywords":["preco"],"mode":"contains","oncePerUser":true}', pg_temp.g('dm'))$$,'admin edita');

select tests.authenticate_as(:'uag');
select throws_ok($$select public.save_mcp_automation('$$||:'oa'||$$', null, 'X', '{}', 'keyword_detected',
  '{"keywords":["a"],"mode":"contains"}', pg_temp.g('x'))$$,'42501',null,'agent não salva');
select tests.authenticate_as(:'uv');
select throws_ok($$select public.save_mcp_automation('$$||:'oa'||$$', null, 'X', '{}', 'keyword_detected',
  '{"keywords":["a"],"mode":"contains"}', pg_temp.g('x'))$$,'42501',null,'viewer não salva');
select tests.authenticate_as(:'ub');
select throws_ok($$select public.save_mcp_automation('$$||:'ob'||$$', '$$||:'dm'||$$', 'X', '{}', 'keyword_detected',
  '{"keywords":["a"],"mode":"contains"}', pg_temp.g('dm'))$$,'P0002',null,'automação de outra organização');

-- =============================================================== automação do painel / stale
select tests.authenticate_as(:'ua');
select public.save_automation(:'oa', null, 'Do painel', 'keyword_detected', '{"keywords":["oi"],"mode":"contains"}', pg_temp.g('panel')) as panel \gset
select is((select mcp_spec_stale from public.automations where id=:'panel'),false,'automação do painel não fica stale');
select throws_ok($$select public.save_mcp_automation('$$||:'oa'||$$', '$$||:'panel'||$$', 'X', '{}', 'keyword_detected',
  '{"keywords":["a"],"mode":"contains"}', pg_temp.g('panel'))$$,'22023','not_mcp_automation','não edita automação do painel');

select public.save_automation(:'oa', :'dm', 'Editada no painel', 'keyword_detected',
  '{"keywords":["preco"],"mode":"contains","oncePerUser":true}', pg_temp.g('dm'));
select is((select mcp_spec_stale from public.automations where id=:'dm'),true,'salvar pelo painel marca stale');
select isnt((select mcp_spec from public.automations where id=:'dm'),null,'mcp_spec preservado');
select throws_ok($$select public.save_mcp_automation('$$||:'oa'||$$', '$$||:'dm'||$$', 'Preço por DM', '{"gatilho":"dm"}',
  'keyword_detected', '{"keywords":["preco"],"mode":"contains","oncePerUser":true}', pg_temp.g('dm'))$$,
  '22023','panel_modified','stale sem confirmação');
select is((select name from public.automations where id=:'dm'),'Editada no painel','nada sobrescrito sem confirmação');
select public.save_mcp_automation(:'oa', :'dm', 'Preço por DM', '{"gatilho":"dm","palavras":["preco"],"v":2}',
  'keyword_detected', '{"keywords":["preco"],"mode":"contains","oncePerUser":true}', pg_temp.g('dm'), true);
select is((select mcp_spec_stale from public.automations where id=:'dm'),false,'confirmar sobrescrita limpa stale');
select is((select mcp_spec->>'v' from public.automations where id=:'dm'),'2','confirmar sobrescrita grava spec');
select is((select name from public.automations where id=:'dm'),'Preço por DM','confirmar sobrescrita grava nome');

-- =============================================================== uma vez por contato: DM com palavra
select public.save_mcp_automation(:'oa', null, 'Story', '{"gatilho":"story"}', 'instagram_story',
  '{"channelId":"00000000-0000-0000-0000-000000005701","oncePerUser":true}', pg_temp.g('story')) as story \gset
select public.save_automation(:'oa', null, 'Repete', 'keyword_detected', '{"keywords":["repete"],"mode":"contains"}', pg_temp.g('rep')) as rep \gset
select public.activate_automation(:'dm');
select public.activate_automation(:'story');
select public.activate_automation(:'rep');
select tests.clear_authentication();

select pg_temp.ingest('d1','+5557000000001','qual o preco?');
select is(pg_temp.runs(:'dm'),1,'DM com palavra dispara');
select pg_temp.finish(:'dm');
select pg_temp.ingest('d2','+5557000000001','e o preco agora?');
select is(pg_temp.runs(:'dm'),1,'oncePerUser: mesmo contato não dispara de novo');
select pg_temp.ingest('d3','+5557000000002','qual o preco?');
select is(pg_temp.runs(:'dm'),2,'oncePerUser: outro contato dispara');
-- falha antes do primeiro envio não conta
select pg_temp.finish(:'dm','failed');
select pg_temp.ingest('d4','+5557000000002','preco?');
select is(pg_temp.runs(:'dm'),3,'falha antes do envio não conta como execução');
select pg_temp.finish(:'dm');
select pg_temp.ingest('d5','+5557000000002','preco de novo');
select is(pg_temp.runs(:'dm'),3,'depois de uma execução concluída não dispara de novo');

-- =============================================================== uma vez por contato: story
select pg_temp.ingest('s1','+5557000000011','Amei!','{"origin":"story_reply","storyId":"s1"}');
select is(pg_temp.runs(:'story'),1,'story dispara');
select pg_temp.finish(:'story');
select pg_temp.ingest('s2','+5557000000011','Amei de novo!','{"origin":"story_mention"}');
select is(pg_temp.runs(:'story'),1,'oncePerUser: story não dispara de novo para o mesmo contato');
select pg_temp.ingest('s3','+5557000000012','Amei!','{"origin":"story_reply","storyId":"s1"}');
select is(pg_temp.runs(:'story'),2,'oncePerUser: story dispara para outro contato');

-- falha depois de um envio conta como execução
select id as srun from public.automation_runs where automation_id=:'story' and status='pending' \gset
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status,context)
  select organization_id, conversation_id, '00000000-0000-0000-0000-000000005701','outbound','automation','Oi','delivered',
    jsonb_build_object('automation',jsonb_build_object('runId',id))
  from public.automation_runs where id=:'srun';
select pg_temp.finish(:'story','failed');
select pg_temp.ingest('s4','+5557000000012','Amei!','{"origin":"story_reply","storyId":"s4"}');
select is(pg_temp.runs(:'story'),2,'falha depois do primeiro envio conta');

-- =============================================================== sem oncePerUser
select pg_temp.ingest('r1','+5557000000021','repete');
select pg_temp.finish(:'rep');
select pg_temp.ingest('r2','+5557000000021','repete de novo');
select is(pg_temp.runs(:'rep'),2,'sem oncePerUser dispara duas vezes para o mesmo contato');

select * from finish();
rollback;
