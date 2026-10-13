begin;
create extension if not exists pgtap with schema extensions;
select plan(92);
select tests.create_user('owner40@t.test','Dona Ana') as ua \gset
select tests.create_user('agent40@t.test','Beto Agente') as uag \gset
select tests.create_user('viewer40@t.test','Vera Viewer') as uv \gset
select tests.create_user('owner40b@t.test','Outra') as ub \gset
select tests.create_org(:'ua','Org40A') as oa \gset
select tests.create_org(:'ub','Org40B') as ob \gset
select tests.add_member(:'oa',:'uag','agent');
select tests.add_member(:'oa',:'uv','viewer');

insert into public.ai_agents(organization_id,name,personality,objective,tone,system_prompt,is_active,auto_reply,human_handoff)
  values (:'oa','Lia','Simpática','Vender','cordial','Seja breve',true,true,true);
insert into public.channels(id,organization_id,type,name,status) values
  ('00000000-0000-0000-0000-000000004001',:'oa','simulator','Sim40','active');
insert into public.tags(id,organization_id,name) values
  ('00000000-0000-0000-0000-000000004011',:'oa','vip'),
  ('00000000-0000-0000-0000-000000004012',:'oa','frio');
insert into public.pipelines(id,organization_id,name,is_default) values ('00000000-0000-0000-0000-000000004021',:'oa','Padrão',true);
insert into public.pipeline_stages(id,organization_id,pipeline_id,name,position) values
  ('00000000-0000-0000-0000-000000004022',:'oa','00000000-0000-0000-0000-000000004021','Novo',0),
  ('00000000-0000-0000-0000-000000004023',:'oa','00000000-0000-0000-0000-000000004021','Qualificado',1);

-- helpers
create function pg_temp.nid(p_auto uuid, p_k text) returns uuid language sql as $$ select md5(p_auto::text || p_k)::uuid $$;
-- automação ativa (versão 1): trigger -> message (nó de espera)
create function pg_temp.mk(p_id uuid, p_org uuid, p_type text, p_cfg jsonb, p_at timestamptz default now()) returns uuid
language plpgsql as $$
declare g jsonb := jsonb_build_object(
  'nodes', jsonb_build_array(
    jsonb_build_object('id', pg_temp.nid(p_id,'t'), 'type','trigger','config','{}'::jsonb,'position','{"x":0,"y":0}'::jsonb),
    jsonb_build_object('id', pg_temp.nid(p_id,'w'), 'type','message','config','{"mode":"text","text":"Oi"}'::jsonb,'position','{"x":0,"y":0}'::jsonb)),
  'edges', jsonb_build_array(jsonb_build_object('id', pg_temp.nid(p_id,'e'), 'source', pg_temp.nid(p_id,'t'),
    'target', pg_temp.nid(p_id,'w'), 'sourceHandle','default')));
begin
  insert into public.automations (id, organization_id, name, trigger_type, trigger_config, status, activated_at, current_version)
    values (p_id, p_org, 'Auto ' || p_type, p_type::public.automation_trigger_type, p_cfg, 'active', p_at, 1);
  insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph)
    values (p_org, p_id, 1, p_type::public.automation_trigger_type, p_cfg, g);
  return p_id;
end $$;
create function pg_temp.ingest(p_ext text, p_sender text, p_text text, p_ctx jsonb default '{}') returns uuid language sql as $$
  select public.ingest_inbound_message('00000000-0000-0000-0000-000000004001', p_ext, p_sender, 'Cliente', p_text, now(), p_ctx) $$;
create function pg_temp.conv_of(p_msg uuid) returns uuid language sql as $$
  select conversation_id from public.messages where id = p_msg $$;
create function pg_temp.runs(p_conv uuid) returns int language sql as $$
  select count(*)::int from public.automation_runs where conversation_id = p_conv $$;
create function pg_temp.run_of(p_conv uuid) returns uuid language sql as $$
  select id from public.automation_runs where conversation_id = p_conv order by created_at desc, id limit 1 $$;
create function pg_temp.jobs(p_conv uuid) returns int language sql as $$
  select count(*)::int from public.ai_jobs where conversation_id = p_conv and kind = 'reply' and state = 'pending' $$;
create function pg_temp.wait(p_run uuid) returns void language sql as $$
  update public.automation_runs set status = 'waiting', waiting_for = 'reply', input = null,
    wait_node_id = md5(automation_id::text || 'w')::uuid, resume_at = now() + interval '1 day' where id = p_run $$;
create function pg_temp.pause_all() returns void language sql as $$
  update public.automations set status = 'paused' where status = 'active' $$;

-- =============================================================== estrutura e segurança
select has_function('public','ingest_inbound_message',array['uuid','text','text','text','text','timestamp with time zone','jsonb'],'ingest de 7 argumentos');
select has_trigger('public','messages','aa_automation_inbound','gatilho aa_automation_inbound');
select ok('aa_automation_inbound' < 'ai_enqueue_reply','aa_automation_inbound dispara antes de ai_enqueue_reply');
select has_trigger('public','contact_tags','contact_tags_emit_tag_added','gatilho tag_added');
select ok(has_function_privilege('authenticated','public.stop_automation(uuid)','execute'),'authenticated executa stop_automation');
select ok(not has_function_privilege('anon','public.stop_automation(uuid)','execute'),'anon não executa stop_automation');
select ok(not has_function_privilege('authenticated','private.automation_payload(uuid,uuid,text)','execute'),'authenticated não assina payload');
select ok(not has_function_privilege('authenticated','private.automation_verify_payload(text)','execute'),'authenticated não verifica payload');
select ok(not has_function_privilege('anon','public.ingest_inbound_message(uuid,text,text,text,text,timestamptz,jsonb)','execute'),'anon não executa ingest de 7 argumentos');
select ok(has_function_privilege('service_role','public.ingest_inbound_message(uuid,text,text,text,text,timestamptz,jsonb)','execute'),'service_role executa ingest de 7 argumentos');
select is(private.automation_normalize('  PROMOÇÃO   Já! '),'promocao ja!','normalize: minúsculas, sem acento, espaços colapsados');

-- ingest grava context; a variante de 6 argumentos delega
select pg_temp.ingest('ctx1','+5540000000001','Oi','{"origin":"direct"}') as mctx \gset
select is((select context->>'origin' from public.messages where id=:'mctx'),'direct','7 argumentos grava context na inserção');
select public.ingest_inbound_message('00000000-0000-0000-0000-000000004001','ctx2','+5540000000001','Cliente','Oi de novo',now()) as mctx2 \gset
select is((select context::text from public.messages where id=:'mctx2'),'{}','6 argumentos delega com context vazio');
select throws_ok($$select pg_temp.ingest('ctx3','+5540000000001','Oi','[1]')$$,'22023',null,'context não-objeto rejeitado');

-- =============================================================== palavra-chave
select pg_temp.mk('00000000-0000-0000-0000-0000000040a1',:'oa','keyword_detected','{"keywords":["Promoção"],"mode":"contains"}') as k1 \gset
select pg_temp.ingest('k1','+5540000000010','Quero a PROMOCAO!') as mk1 \gset
select pg_temp.conv_of(:'mk1') as ck1 \gset
select pg_temp.run_of(:'ck1') as rk1 \gset
select is(pg_temp.runs(:'ck1'),1,'palavra-chave com acento/maiúsculas cria execução');
select is((select (automation_id, status, version, current_node_id = pg_temp.nid(automation_id,'t'), contact_id is not null)::text
  from public.automation_runs where id=:'rk1'),'(00000000-0000-0000-0000-0000000040a1,pending,1,t,t)','execução pending na versão corrente, no nó gatilho');
select ok((select resume_at <= now() from public.automation_runs where id=:'rk1'),'execução vence agora');
select is((select automation_run_id from public.conversations where id=:'ck1'),:'rk1'::uuid,'conversa aponta a execução');
select is((select e.type from public.events e join public.automation_runs r on r.trigger_event_id=e.id where r.id=:'rk1'),'automation_trigger','evento automation_trigger registrado');
select is(pg_temp.jobs(:'ck1'),0,'palavra-chave: IA não enfileirada');
select pg_temp.ingest('k1b','+5540000000010','E aí?');
select is(pg_temp.runs(:'ck1'),1,'execução ativa: nova mensagem não cria execução');
select is(pg_temp.jobs(:'ck1'),0,'execução ativa: IA não enfileirada');

-- modos equals / starts_with
select pg_temp.mk('00000000-0000-0000-0000-0000000040a2',:'oa','keyword_detected','{"keywords":["preço"],"mode":"equals"}') as k2 \gset
select pg_temp.mk('00000000-0000-0000-0000-0000000040a3',:'oa','keyword_detected','{"keywords":["catalogo"],"mode":"starts_with"}') as k3 \gset
select pg_temp.ingest('eq1','+5540000000011','qual o preço') as meq1 \gset
select is(pg_temp.runs(pg_temp.conv_of(:'meq1')),0,'equals não casa texto maior');
select pg_temp.ingest('eq2','+5540000000012','  PREÇO ') as meq2 \gset
select is((select automation_id from public.automation_runs where conversation_id=pg_temp.conv_of(:'meq2')),:'k2'::uuid,'equals casa ignorando acento/maiúsculas/espaços');
select pg_temp.ingest('sw1','+5540000000013','Catálogo completo') as msw1 \gset
select is((select automation_id from public.automation_runs where conversation_id=pg_temp.conv_of(:'msw1')),:'k3'::uuid,'starts_with casa');
select pg_temp.ingest('sw2','+5540000000014','quero o catalogo') as msw2 \gset
select is(pg_temp.runs(pg_temp.conv_of(:'msw2')),0,'starts_with não casa no meio');

-- =============================================================== sem casamento
select pg_temp.ingest('n1','+5540000000020','Bom dia') as mn1 \gset
select pg_temp.conv_of(:'mn1') as cn1 \gset
select is(pg_temp.runs(:'cn1'),0,'sem casamento: nenhuma execução');
select is(pg_temp.jobs(:'cn1'),1,'sem casamento: IA enfileirada como antes');

-- =============================================================== RF1 + payload assinado
select pg_temp.wait(:'rk1');
select private.automation_payload(:'rk1', pg_temp.nid(:'k1','w'), 'sim') as pay \gset
select ok(:'pay' ~ ('^fa1\.' || :'rk1' || '\.' || pg_temp.nid(:'k1','w') || '\.sim\.[0-9a-f]{16}$'),'formato fa1.<run>.<node>.<option>.<hmac16>');
select is(private.automation_verify_payload(:'pay'),
  jsonb_build_object('runId',:'rk1','nodeId',pg_temp.nid(:'k1','w'),'optionId','sim'),'payload válido verificado');
select is(private.automation_verify_payload(left(:'pay', length(:'pay')-1) || case when right(:'pay',1)='0' then '1' else '0' end),null,'hmac adulterado: null');
select is(private.automation_verify_payload(replace(:'pay','.sim.','.nao.')),null,'opção trocada: null');
select is(private.automation_verify_payload('lixo'),null,'payload qualquer: null');
select is(private.automation_verify_payload(null),null,'payload nulo: null');
select throws_ok(format($$select private.automation_payload(%L, %L, 'Sim!')$$, :'rk1', pg_temp.nid(:'k1','w')),'22023',null,'opção inválida rejeitada');

select pg_temp.ingest('rf1a','+5540000000010','Sim',jsonb_build_object('origin','quick_reply','payload',:'pay'));
select is((select input from public.automation_runs where id=:'rk1'),'{"text": "Sim", "optionId": "sim"}'::jsonb,'RF1: primeira mensagem retoma com optionId');
select ok((select status = 'waiting' and resume_at <= now() from public.automation_runs where id=:'rk1'),'RF1: execução vence agora');
select pg_temp.ingest('rf1b','+5540000000010','Oi? alguém?');
select is((select input->>'optionId' from public.automation_runs where id=:'rk1'),'sim','RF1: segunda mensagem não sobrescreve a retomada');
select is(pg_temp.runs(:'ck1'),1,'RF1: segunda mensagem não cria execução');
select is(pg_temp.jobs(:'ck1'),0,'RF1: segunda mensagem não cria tarefa de IA');

-- payload adulterado / de outra execução / de outro nó
select pg_temp.ingest('t1','+5540000000030','promoção') as mt1 \gset
select pg_temp.run_of(pg_temp.conv_of(:'mt1')) as rt1 \gset
select pg_temp.wait(:'rt1');
select pg_temp.ingest('t1b','+5540000000030','Sim',jsonb_build_object('payload',left(:'pay', length(:'pay')-1) || 'x'));
select is((select input from public.automation_runs where id=:'rt1'),'{"text": "Sim", "optionId": null}'::jsonb,'payload adulterado: optionId null');
select pg_temp.wait(:'rt1');
select pg_temp.ingest('t1c','+5540000000030','Sim',jsonb_build_object('payload',:'pay'));
select is((select input->'optionId' from public.automation_runs where id=:'rt1'),'null'::jsonb,'payload de outra execução: optionId null');
select pg_temp.wait(:'rt1');
select pg_temp.ingest('t1d','+5540000000030','Sim',jsonb_build_object('payload',private.automation_payload(:'rt1', pg_temp.nid(:'k1','t'), 'sim')));
select is((select input->'optionId' from public.automation_runs where id=:'rt1'),'null'::jsonb,'payload de outro nó: optionId null');
select pg_temp.wait(:'rt1');
select pg_temp.ingest('t1e','+5540000000030','Sim',jsonb_build_object('payload',private.automation_payload(:'rt1', pg_temp.nid(:'k1','w'), 'sim')));
select is((select input->>'optionId' from public.automation_runs where id=:'rt1'),'sim','payload da própria execução: optionId resolvido');

-- =============================================================== primeira mensagem
select pg_temp.pause_all();
select pg_temp.mk('00000000-0000-0000-0000-0000000040c1',:'oa','message_received','{"firstMessageOnly":true}') as fm \gset
select pg_temp.ingest('f1','+5540000000040','Olá') as mf1 \gset
select pg_temp.conv_of(:'mf1') as cf1 \gset
select is((select count(*)::int from public.automation_runs where automation_id=:'fm' and conversation_id=:'cf1'),1,'firstMessageOnly: primeira mensagem dispara');
update public.automation_runs set status='completed' where conversation_id=:'cf1';
update public.conversations set automation_run_id=null where id=:'cf1';
select pg_temp.ingest('f2','+5540000000040','Olá de novo');
select is((select count(*)::int from public.automation_runs where automation_id=:'fm' and conversation_id=:'cf1'),1,'firstMessageOnly: segunda mensagem não dispara');
select is(pg_temp.jobs(:'cf1'),1,'firstMessageOnly: segunda mensagem vai para a IA');
-- sem firstMessageOnly: qualquer mensagem
update public.automations set status='paused' where id=:'fm';
select pg_temp.mk('00000000-0000-0000-0000-0000000040c2',:'oa','message_received','{"firstMessageOnly":false}') as fm2 \gset
select pg_temp.ingest('f3','+5540000000040','Mais uma');
select is((select count(*)::int from public.automation_runs where automation_id=:'fm2' and conversation_id=:'cf1'),1,'firstMessageOnly=false: mensagem seguinte dispara');
select is(pg_temp.jobs(:'cf1'),0,'nova execução cancela a tarefa de IA pendente');

-- =============================================================== ordem e anti-loop
select pg_temp.pause_all();
select pg_temp.mk('00000000-0000-0000-0000-0000000040d9',:'oa','keyword_detected','{"keywords":["pedido"],"mode":"contains"}', now()-interval '2 hours') as o_old \gset
select pg_temp.mk('00000000-0000-0000-0000-0000000040d1',:'oa','keyword_detected','{"keywords":["pedido"],"mode":"contains"}', now()-interval '1 hour') as o_new \gset
select pg_temp.mk('00000000-0000-0000-0000-0000000040d5',:'oa','message_received','{"firstMessageOnly":false}', now()-interval '1 hour') as o_any \gset
select pg_temp.ingest('o1','+5540000000050','Meu pedido') as mo1 \gset
select is((select automation_id from public.automation_runs where conversation_id=pg_temp.conv_of(:'mo1')),:'o_old'::uuid,'a automação ativada há mais tempo vence');
update public.automations set activated_at = now()-interval '1 hour' where id=:'o_old';
select pg_temp.ingest('o2','+5540000000051','Meu pedido') as mo2 \gset
select is((select automation_id from public.automation_runs where conversation_id=pg_temp.conv_of(:'mo2')),:'o_new'::uuid,'empate em activated_at: menor id vence');
select pg_temp.ingest('o3','+5540000000052','Oi') as mo3 \gset
select pg_temp.conv_of(:'mo3') as co3 \gset
update public.automation_runs set status='completed' where conversation_id=:'co3';
update public.conversations set automation_run_id=null where id=:'co3';
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status)
  values (:'oa',:'co3','00000000-0000-0000-0000-000000004001','outbound','automation','Seu pedido','delivered');
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status)
  values (:'oa',:'co3','00000000-0000-0000-0000-000000004001','inbound','automation','pedido','delivered');
select is(pg_temp.runs(:'co3'),1,'anti-loop: mensagens de automação não disparam');

-- =============================================================== story
select pg_temp.pause_all();
select pg_temp.mk('00000000-0000-0000-0000-0000000040e1',:'oa','instagram_story','{"channelId":"00000000-0000-0000-0000-000000004001"}') as st \gset
select pg_temp.mk('00000000-0000-0000-0000-0000000040e2',:'oa','instagram_story','{"channelId":"00000000-0000-0000-0000-0000000040ff"}', now()-interval '1 day') as st_other \gset
select pg_temp.ingest('s1','+5540000000060','Amei!','{"origin":"story_reply","storyId":"s1"}') as ms1 \gset
select is((select automation_id from public.automation_runs where conversation_id=pg_temp.conv_of(:'ms1')),:'st'::uuid,'resposta a story dispara instagram_story do canal');
select pg_temp.ingest('s2','+5540000000061','[Menção em story]','{"origin":"story_mention"}') as ms2 \gset
select is((select automation_id from public.automation_runs where conversation_id=pg_temp.conv_of(:'ms2')),:'st'::uuid,'menção em story dispara instagram_story');
select pg_temp.ingest('s3','+5540000000062','Amei!','{"origin":"direct"}') as ms3 \gset
select is(pg_temp.runs(pg_temp.conv_of(:'ms3')),0,'mensagem direta não dispara instagram_story');

-- =============================================================== CRM: tag_added, contact_created, stage_changed
select pg_temp.pause_all();
select pg_temp.mk('00000000-0000-0000-0000-0000000040f1',:'oa','tag_added','{"tagId":"00000000-0000-0000-0000-000000004011"}') as tg \gset
select pg_temp.mk('00000000-0000-0000-0000-0000000040f2',:'ob','tag_added','{"tagId":null}') as tg_b \gset
select contact_id as kn1 from public.conversations where id=:'cn1' \gset
select is(pg_temp.jobs(:'cn1'),1,'(pré) conversa sem automação tem tarefa de IA');
insert into public.contact_tags(organization_id,contact_id,tag_id) values (:'oa',:'kn1','00000000-0000-0000-0000-000000004011');
select is((select payload->>'tag_id' from public.events where type='tag_added' and contact_id=:'kn1'),'00000000-0000-0000-0000-000000004011','evento tag_added emitido com tag_id');
select is((select count(*)::int from public.automation_runs r join public.events e on e.id=r.trigger_event_id
  where r.automation_id=:'tg' and e.type='tag_added' and r.contact_id=:'kn1' and r.conversation_id=:'cn1' and r.status='pending'),1,'tag específica dispara, ligada à conversa aberta');
select is((select automation_run_id from public.conversations where id=:'cn1'),(select id from public.automation_runs where automation_id=:'tg'),'conversa vinculada à execução de tag');
select is(pg_temp.jobs(:'cn1'),0,'vínculo cancela a tarefa de IA pendente');
select is((select count(*)::int from public.automation_runs where automation_id=:'tg_b'),0,'automação de outra organização não dispara');
insert into public.contact_tags(organization_id,contact_id,tag_id) values (:'oa',:'kn1','00000000-0000-0000-0000-000000004012');
select is((select count(*)::int from public.automation_runs where automation_id=:'tg'),1,'outra tag não dispara');
-- save_contact só emite tag_added para tags novas
select tests.authenticate_as(:'ua');
select lives_ok(format($$select public.save_contact(%L,%L,'{}'::jsonb,array['00000000-0000-0000-0000-000000004011','00000000-0000-0000-0000-000000004012']::uuid[],null)$$, :'oa', :'kn1'),'save_contact com as mesmas tags');
select tests.clear_authentication();
select is((select count(*)::int from public.events where type='tag_added' and contact_id=:'kn1'),2,'salvar contato sem mudar tags não emite tag_added');
select is((select count(*)::int from public.contact_tags where contact_id=:'kn1'),2,'tags mantidas');

select pg_temp.mk('00000000-0000-0000-0000-0000000040f3',:'oa','contact_created','{}') as cc \gset
insert into public.contacts(id,organization_id,name) values ('00000000-0000-0000-0000-000000004031',:'oa','Novo');
select is((select (r.conversation_id is null, r.status, e.type, r.current_node_id = pg_temp.nid(:'cc','t'))::text from public.automation_runs r
  join public.events e on e.id=r.trigger_event_id
  where r.automation_id=:'cc' and r.contact_id='00000000-0000-0000-0000-000000004031'),'(t,pending,contact_created,t)','contact_created dispara sem conversa');
update public.automations set status='paused' where id=:'cc';

select pg_temp.mk('00000000-0000-0000-0000-0000000040f4',:'oa','stage_changed','{"stageId":"00000000-0000-0000-0000-000000004023"}') as sc \gset
insert into public.deals(id,organization_id,pipeline_id,stage_id,contact_id,title) values
  ('00000000-0000-0000-0000-000000004041',:'oa','00000000-0000-0000-0000-000000004021','00000000-0000-0000-0000-000000004022','00000000-0000-0000-0000-000000004031','Negócio');
select is((select count(*)::int from public.automation_runs where automation_id=:'sc'),0,'etapa diferente não dispara');
update public.deals set stage_id='00000000-0000-0000-0000-000000004023' where id='00000000-0000-0000-0000-000000004041';
select is((select e.type from public.automation_runs r join public.events e on e.id=r.trigger_event_id where r.automation_id=:'sc'),'deal_stage_changed','mudança para a etapa configurada dispara');
select pg_temp.mk('00000000-0000-0000-0000-0000000040f5',:'oa','stage_changed','{"stageId":null}') as sc_any \gset
insert into public.contacts(id,organization_id,name) values ('00000000-0000-0000-0000-000000004032',:'oa','Outro');
insert into public.deals(organization_id,pipeline_id,stage_id,contact_id,title) values
  (:'oa','00000000-0000-0000-0000-000000004021','00000000-0000-0000-0000-000000004022','00000000-0000-0000-0000-000000004032','Negócio 2');
select is((select e.type from public.automation_runs r join public.events e on e.id=r.trigger_event_id where r.automation_id=:'sc_any'),'deal_created','qualquer etapa: criação do negócio dispara');
select is((select count(*)::int from public.automation_runs where automation_id=:'sc'),1,'etapa específica não dispara na criação em outra etapa');

-- =============================================================== RF2: pausar mantém; excluir cancela e libera para a IA
select pg_temp.pause_all();
select pg_temp.mk('00000000-0000-0000-0000-0000000040a5',:'oa','keyword_detected','{"keywords":["agendar"],"mode":"contains"}') as p1 \gset
select pg_temp.ingest('p1','+5540000000070','Quero agendar') as mp1 \gset
select pg_temp.conv_of(:'mp1') as cp1 \gset
select pg_temp.run_of(:'cp1') as rp1 \gset
select pg_temp.wait(:'rp1');
select tests.authenticate_as(:'ua');
select lives_ok(format($$select public.pause_automation(%L)$$, :'p1'),'pausar automação');
select tests.clear_authentication();
select is((select status::text from public.automation_runs where id=:'rp1'),'waiting','RF2: pausar mantém execução em espera');
select is((select automation_run_id from public.conversations where id=:'cp1'),:'rp1'::uuid,'RF2: pausar mantém o vínculo');
select pg_temp.ingest('p2','+5540000000070','Amanhã');
select is((select input->>'text' from public.automation_runs where id=:'rp1'),'Amanhã','RF2: execução de automação pausada ainda é retomada');
select is(pg_temp.jobs(:'cp1'),0,'RF2: pausada com execução ativa: IA não enfileirada');
select pg_temp.wait(:'rp1');
select tests.authenticate_as(:'ua');
select lives_ok(format($$select public.delete_automation(%L)$$, :'p1'),'excluir automação');
select tests.clear_authentication();
select is((select count(*)::int from public.automation_runs where automation_id=:'p1'),0,'RF2: excluir remove/cancela as execuções');
select is((select automation_run_id from public.conversations where id=:'cp1'),null,'RF2: excluir limpa o vínculo');
select pg_temp.ingest('p3','+5540000000070','Alô?');
select is(pg_temp.runs(:'cp1'),0,'RF2: próxima mensagem não cria execução');
select is(pg_temp.jobs(:'cp1'),1,'RF2: próxima mensagem vai para a IA');

-- =============================================================== RF3: excluir contato
select pg_temp.mk('00000000-0000-0000-0000-0000000040a6',:'oa','keyword_detected','{"keywords":["apagar"],"mode":"contains"}') as d1 \gset
select pg_temp.ingest('d1','+5540000000080','pode apagar') as md1 \gset
select pg_temp.conv_of(:'md1') as cd1 \gset
select pg_temp.run_of(:'cd1') as rd1 \gset
select pg_temp.wait(:'rd1');
select contact_id as kd1 from public.conversations where id=:'cd1' \gset
delete from public.contacts where id=:'kd1';
select is((select (status, conversation_id is null, contact_id is null)::text from public.automation_runs where id=:'rd1'),'(cancelled,t,t)','RF3: excluir contato cancela a execução em espera');
select is((select count(*)::int from public.automation_runs where status='cancelled' and id=:'rd1'),1,'RF3: execução continua registrada como cancelada');
delete from public.contacts where id=:'kn1';
select is((select status::text from public.automation_runs where automation_id=:'tg'),'cancelled','RF3: execução pendente de CRM cancelada ao excluir o contato');

-- =============================================================== fechar e parar
select pg_temp.mk('00000000-0000-0000-0000-0000000040a7',:'oa','keyword_detected','{"keywords":["fechar"],"mode":"contains"}') as e1 \gset
select pg_temp.ingest('e1','+5540000000090','pode fechar') as me1 \gset
select pg_temp.conv_of(:'me1') as ce1 \gset
select pg_temp.run_of(:'ce1') as re1 \gset
select pg_temp.wait(:'re1');
update public.conversations set status='closed' where id=:'ce1';
select is((select status::text from public.automation_runs where id=:'re1'),'cancelled','fechar a conversa cancela a execução em espera');
select is((select automation_run_id from public.conversations where id=:'ce1'),null,'fechar a conversa limpa o vínculo');

select pg_temp.mk('00000000-0000-0000-0000-0000000040a8',:'oa','keyword_detected','{"keywords":["parar"],"mode":"contains"}') as s1 \gset
select pg_temp.ingest('x1','+5540000000091','vou parar') as mx1 \gset
select pg_temp.conv_of(:'mx1') as cx1 \gset
select pg_temp.run_of(:'cx1') as rx1 \gset
select tests.authenticate_as(:'uv');
select throws_ok(format($$select public.stop_automation(%L)$$, :'cx1'),'42501',null,'viewer não para automação');
select tests.authenticate_as(:'ub');
select throws_ok(format($$select public.stop_automation(%L)$$, :'cx1'),'42501',null,'membro de outra organização não para automação');
select tests.authenticate_as(:'uag');
select lives_ok(format($$select public.stop_automation(%L)$$, :'cx1'),'agent para automação');
select tests.clear_authentication();
select is((select status::text from public.automation_runs where id=:'rx1'),'cancelled','stop_automation cancela a execução');
select is((select automation_run_id from public.conversations where id=:'cx1'),null,'stop_automation limpa o vínculo');
select is((select count(*)::int from public.messages where conversation_id=:'cx1' and sender_type='system'
  and content='Automação interrompida por Beto Agente'),1,'mensagem de sistema com o nome do agente');
select pg_temp.ingest('x2','+5540000000091','oi');
select is(pg_temp.jobs(:'cx1'),1,'depois de parar, a IA volta a responder');

select * from finish();
rollback;
