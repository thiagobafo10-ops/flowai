begin;
create extension if not exists pgtap with schema extensions;
select plan(189);
select tests.create_user('owner41@t.test','Dona Ana') as ua \gset
select tests.create_user('agent41@t.test','Beto Agente') as uag \gset
select tests.create_user('out41@t.test','Fora') as uout \gset
select tests.create_org(:'ua','Org41A') as oa \gset
select tests.create_org(:'uout','Org41B') as ob \gset
select tests.add_member(:'oa',:'uag','agent');

insert into public.ai_agents(organization_id,name,personality,objective,tone,system_prompt,is_active,auto_reply,human_handoff)
  values (:'oa','Lia','Simpática','Vender','cordial','Seja breve',true,true,false);
insert into public.channels(id,organization_id,type,name,status) values
  ('00000000-0000-0000-0000-000000004101',:'oa','simulator','Sim41','active'),
  ('00000000-0000-0000-0000-000000004102',:'oa','instagram','IG41','active');
insert into public.tags(id,organization_id,name) values
  ('00000000-0000-0000-0000-000000004111',:'oa','vip'),
  ('00000000-0000-0000-0000-000000004112',:'ob','outra');
insert into public.pipelines(id,organization_id,name,is_default) values ('00000000-0000-0000-0000-000000004121',:'oa','Padrão',true);
insert into public.pipeline_stages(id,organization_id,pipeline_id,name,position) values
  ('00000000-0000-0000-0000-000000004122',:'oa','00000000-0000-0000-0000-000000004121','Novo',0),
  ('00000000-0000-0000-0000-000000004123',:'oa','00000000-0000-0000-0000-000000004121','Qualificado',1);

-- grafo da versão 1 (automação pausada: nada dispara sozinho neste teste)
create function pg_temp.n(p_k text) returns uuid language sql as $$ select md5('041' || p_k)::uuid $$;
select pg_temp.n('t') as nt, pg_temp.n('m') as nm, pg_temp.n('g') as ng, pg_temp.n('d') as nd,
  pg_temp.n('ai') as nai, pg_temp.n('h') as nh, pg_temp.n('e') as ne, pg_temp.n('auto') as auto \gset
create function pg_temp.node(p_k text, p_type text, p_cfg jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', pg_temp.n(p_k), 'type', p_type, 'config', p_cfg, 'position', '{"x":0,"y":0}'::jsonb) $$;
create function pg_temp.edge(p_k text, p_s text, p_t text, p_h text) returns jsonb language sql as $$
  select jsonb_build_object('id', pg_temp.n(p_k), 'source', pg_temp.n(p_s), 'target', pg_temp.n(p_t), 'sourceHandle', p_h) $$;
insert into public.automations (id, organization_id, name, trigger_type, trigger_config, status, activated_at, current_version)
  values (:'auto', :'oa', 'Fluxo 41', 'contact_created', '{}', 'paused', now(), 1);
insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph)
  values (:'oa', :'auto', 1, 'contact_created', '{}', jsonb_build_object(
    'nodes', jsonb_build_array(
      pg_temp.node('t','trigger','{}'),
      pg_temp.node('m','message','{"mode":"text","text":"Escolha","replyTimeoutHours":24,"buttons":[{"id":"a1","title":"Sim","kind":"path"},{"id":"u1","title":"Site","kind":"url","url":"https://exemplo.com.br"}]}'),
      pg_temp.node('g','tag','{"tagId":"00000000-0000-0000-0000-000000004111"}'),
      pg_temp.node('d','delay','{"minutes":10}'),
      pg_temp.node('ai','message','{"mode":"ai"}'),
      pg_temp.node('h','handoff_human','{}'),
      pg_temp.node('e','end','{}')),
    'edges', jsonb_build_array(
      pg_temp.edge('e1','t','m','default'), pg_temp.edge('e2','m','g','opt:a1'), pg_temp.edge('e3','m','e','no_reply'),
      pg_temp.edge('e4','g','d','default'), pg_temp.edge('e5','d','e','default'),
      pg_temp.edge('e6','ai','e','sent'), pg_temp.edge('e7','ai','h','handoff'), pg_temp.edge('e8','h','e','default'))));

-- contatos e conversas
create function pg_temp.contact(p_k text, p_phone text default null, p_ig text default null) returns uuid language sql as $$
  insert into public.contacts(id, organization_id, name, phone, instagram_id)
    values (pg_temp.n('k' || p_k), (select id from public.organizations where name = 'Org41A'), 'Maria Silva', p_phone, p_ig)
    returning id $$;
create function pg_temp.conv(p_k text, p_channel uuid) returns uuid language sql as $$
  insert into public.conversations(id, organization_id, contact_id, channel_id)
    values (pg_temp.n('c' || p_k), (select id from public.organizations where name = 'Org41A'), pg_temp.n('k' || p_k), p_channel)
    returning id $$;
-- execução na versão 1 no nó p_node; vinculada à conversa quando houver
create function pg_temp.run(p_k text, p_conv uuid, p_contact uuid, p_node uuid) returns uuid language plpgsql as $$
declare v_event uuid; v_run uuid; v_org uuid := (select id from public.organizations where name = 'Org41A');
begin
  insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, payload)
    values (v_org, 'automation_trigger', p_conv, p_contact, 'system', '{}') returning id into v_event;
  insert into public.automation_runs (id, organization_id, automation_id, trigger_event_id, conversation_id, contact_id,
      status, current_node_id, resume_at, version)
    values (pg_temp.n('r' || p_k), v_org, pg_temp.n('auto'), v_event, p_conv, p_contact, 'pending', p_node, now(), 1)
    returning id into v_run;
  if p_conv is not null then perform private.automation_link_run(p_conv, v_run); end if;
  return v_run;
end $$;
-- reserva direta (o claim real é testado à parte); devolve o token
create function pg_temp.hold(p_run uuid) returns uuid language sql as $$
  update public.automation_runs set status = 'running', attempts = attempts + 1, claim_token = gen_random_uuid(),
    claimed_until = now() + interval '3 minutes' where id = p_run returning claim_token $$;
create function pg_temp.step(p_node uuid, p_route jsonb, p_effects jsonb default '[]', p_handle text default 'default',
  p_iteration int default 0) returns jsonb language sql as $$
  select jsonb_build_object('nodeId', p_node, 'iteration', p_iteration, 'handle', p_handle, 'effects', p_effects, 'route', p_route) $$;
create function pg_temp.st(p_run uuid) returns text language sql as $$
  select status::text from public.automation_runs where id = p_run $$;
create function pg_temp.link(p_conv uuid) returns uuid language sql as $$
  select automation_run_id from public.conversations where id = p_conv $$;

select pg_temp.contact('1', '+5541000000001') as k1 \gset
select pg_temp.conv('1', '00000000-0000-0000-0000-000000004101') as c1 \gset

-- =============================================================== estrutura e grants
select has_function('public','claim_automation_runs',array['integer'],'claim_automation_runs existe');
select has_function('public','prepare_automation_run',array['uuid','uuid'],'prepare_automation_run existe');
select has_function('public','apply_automation_step',array['uuid','uuid','jsonb'],'apply_automation_step existe');
select has_function('public','automation_button_payloads',array['uuid','uuid','uuid'],'automation_button_payloads existe');
select has_function('public','fail_automation_run',array['uuid','uuid','text','boolean'],'fail_automation_run existe');
select has_function('public','rerun_automation_from',array['uuid','uuid'],'rerun_automation_from existe');
select ok(not has_function_privilege('authenticated','public.claim_automation_runs(int)','execute'),'authenticated não executa claim');
select ok(not has_function_privilege('authenticated','public.prepare_automation_run(uuid,uuid)','execute'),'authenticated não executa prepare');
select ok(not has_function_privilege('authenticated','public.apply_automation_step(uuid,uuid,jsonb)','execute'),'authenticated não executa apply');
select ok(not has_function_privilege('authenticated','public.automation_button_payloads(uuid,uuid,uuid)','execute'),'authenticated não executa payloads');
select ok(not has_function_privilege('authenticated','public.fail_automation_run(uuid,uuid,text,boolean)','execute'),'authenticated não executa fail');
select ok(not has_function_privilege('authenticated','public.sweep_automation_runs()','execute'),'authenticated não executa sweep');
select ok(not has_function_privilege('authenticated','public.configure_automation_worker(text,text,text)','execute'),'authenticated não configura o worker');
select ok(not has_function_privilege('authenticated','public.read_automation_worker_config()','execute'),'authenticated não lê a config do worker');
select ok(not has_function_privilege('authenticated','public.dispatch_automation_worker()','execute'),'authenticated não executa dispatch');
select ok(not has_function_privilege('anon','public.dispatch_automation_worker()','execute'),'anon não executa dispatch');
select ok(has_function_privilege('service_role','public.apply_automation_step(uuid,uuid,jsonb)','execute'),'service_role executa apply');
select ok(has_function_privilege('service_role','public.claim_automation_runs(int)','execute'),'service_role executa claim');
select ok(has_function_privilege('authenticated','public.rerun_automation_from(uuid,uuid)','execute'),'authenticated executa rerun (checagem de admin interna)');
select ok(not has_function_privilege('anon','public.rerun_automation_from(uuid,uuid)','execute'),'anon não executa rerun');
select is((select schedule from cron.job where jobname='flowai-automation-worker'),'5 seconds','cron do automation-worker a cada 5 s');
select ok(pg_get_functiondef('public.claim_automation_runs(int)'::regprocedure) ~* 'for update skip locked','claim usa skip locked');

-- =============================================================== claim
select pg_temp.contact('2', '+5541000000002') as k2 \gset
select pg_temp.conv('2', '00000000-0000-0000-0000-000000004101') as c2 \gset
select pg_temp.contact('3', '+5541000000003') as k3 \gset
select pg_temp.conv('3', '00000000-0000-0000-0000-000000004101') as c3 \gset
select pg_temp.run('1', :'c1', :'k1', :'nt') as r1 \gset
select pg_temp.run('2', :'c2', :'k2', :'nd') as r2 \gset
select pg_temp.run('3', :'c3', :'k3', :'nd') as r3 \gset
update public.automation_runs set status='waiting', waiting_for='delay', wait_node_id=:'nd', resume_at=now()-interval '1 second' where id=:'r2';
update public.automation_runs set status='waiting', waiting_for='delay', wait_node_id=:'nd', resume_at=now()+interval '1 hour' where id=:'r3';
select public.claim_automation_runs(10) as cl \gset
select is(jsonb_array_length(:'cl'::jsonb),2,'claim pega pendente e espera vencida (não a futura)');
select ok((select bool_and(x ? 'runId' and x ? 'claimToken') from jsonb_array_elements(:'cl'::jsonb) x),'claim devolve runId e claimToken');
select is((select status::text||'/'||attempts||'/'||(claimed_until between now()+interval '179 seconds' and now()+interval '181 seconds')::text
  from public.automation_runs where id=:'r1'),'running/1/true','claim marca running, attempts+1 e reserva de 3 min');
select is(pg_temp.st(:'r3'),'waiting','espera futura não é reservada');
select is(jsonb_array_length(public.claim_automation_runs(10)),0,'execução reservada não é reservada de novo');
select (select x->>'claimToken' from jsonb_array_elements(:'cl'::jsonb) x where x->>'runId'=:'r1') as t1 \gset
select (select x->>'claimToken' from jsonb_array_elements(:'cl'::jsonb) x where x->>'runId'=:'r2') as t2 \gset

-- token errado: tudo no-op
select is(public.prepare_automation_run(:'r1', gen_random_uuid())->>'action','skip','prepare com token errado: skip');
select is(pg_temp.st(:'r1'),'running','token errado não cancela');
select public.fail_automation_run(:'r1', gen_random_uuid(), 'boom', false);
select is(pg_temp.st(:'r1'),'running','fail com token errado é no-op');
select throws_ok(format($$select public.apply_automation_step(%L, gen_random_uuid(), %L)$$, :'r1',
  pg_temp.step(:'nt', jsonb_build_object('next', :'nm'))),'42501',null,'apply com token errado: 42501');

-- =============================================================== prepare
select public.prepare_automation_run(:'r1', :'t1') as p1 \gset
select is(:'p1'::jsonb->>'action','run','prepare: run');
select is(:'p1'::jsonb->>'currentNodeId',:'nt','prepare: nó atual');
select is(:'p1'::jsonb->'graph',(select graph from public.automation_versions where automation_id=:'auto' and version=1),'prepare: grafo da versão');
select is(:'p1'::jsonb->>'channelType','simulator','prepare: canal');
select is(:'p1'::jsonb->>'conversationId',:'c1','prepare: conversa');
select is(:'p1'::jsonb#>>'{context,contact,name}','Maria Silva','prepare: contexto com o contato');
select is(:'p1'::jsonb#>>'{context,timezone}','America/Sao_Paulo','prepare: fuso da organização');
select ok(not (:'p1'::jsonb ? 'ai'),'prepare: sem ai fora do bloco de IA');

-- RF3 (lado do worker): conversa fechada → skip e cancela
update public.conversations set status='closed' where id=:'c2';
select is(public.prepare_automation_run(:'r2', :'t2')->>'action','skip','prepare: conversa fechada → skip');
select is(pg_temp.st(:'r2'),'cancelled','prepare cancela a execução da conversa fechada');

-- conversa excluída com execução em curso → cancelada; prepare skip
select pg_temp.contact('5', '+5541000000005') as k5 \gset
select pg_temp.conv('5', '00000000-0000-0000-0000-000000004101') as c5 \gset
select pg_temp.run('5', :'c5', :'k5', :'nt') as r5 \gset
select pg_temp.hold(:'r5') as t5 \gset
delete from public.conversations where id=:'c5';
select is(pg_temp.st(:'r5'),'cancelled','excluir a conversa cancela a execução em curso');
select is(public.prepare_automation_run(:'r5', :'t5')->>'action','skip','prepare: conversa excluída → skip');

-- =============================================================== passos no Simulador
select is(public.apply_automation_step(:'r1', :'t1', pg_temp.step(:'nt', jsonb_build_object('next', :'nm')))->>'state','running','trigger → próximo nó');
select is((select current_node_id::text||'/'||step_count from public.automation_runs where id=:'r1'),:'nm'||'/1','current_node_id e step_count avançam');
select throws_ok(format($$select public.apply_automation_step(%L, %L, %L)$$, :'r1', :'t1',
  pg_temp.step(:'ng', jsonb_build_object('next', :'nd'))),'22023',null,'nó diferente do atual: 22023');
select throws_ok(format($$select public.apply_automation_step(%L, %L, %L)$$, :'r1', :'t1',
  pg_temp.step(:'nm', jsonb_build_object('teleport', true))),'22023',null,'rota inválida: 22023');

select pg_temp.step(:'nm',
  jsonb_build_object('waitReply', jsonb_build_object('until', now() + interval '24 hours')),
  '[{"type":"send_text","text":"Escolha","buttons":[{"id":"a1","title":"Sim","kind":"path"},{"id":"u1","title":"Site","kind":"url","url":"https://exemplo.com.br"}]}]',
  null) as st1 \gset
select public.apply_automation_step(:'r1', :'t1', :'st1'::jsonb) as s1 \gset
select is(:'s1'::jsonb->>'state','waiting','botões: execução aguarda resposta');
select is((select waiting_for||'/'||wait_node_id::text||'/'||coalesce(input::text,'null')||'/'||(claim_token is null)::text
  from public.automation_runs where id=:'r1'),'reply/'||:'nm'||'/null/true','espera: waiting_for, wait_node_id, input nulo, reserva liberada');
select ok((select resume_at between now()+interval '24 hours'-interval '1 second' and now()+interval '24 hours'+interval '1 second'
  from public.automation_runs where id=:'r1'),'waitReply: resume_at = prazo');
select is((select sender_type::text||'/'||status::text||'/'||content from public.messages where conversation_id=:'c1' and direction='outbound'),
  'automation/delivered/Escolha','Simulador: mensagem da automação entregue');
select is((select jsonb_array_length(context#>'{automation,buttons}')||'/'||(context#>>'{automation,runId}')||'/'||(context#>>'{automation,nodeId}')
  from public.messages where conversation_id=:'c1' and direction='outbound'),'2/'||:'r1'||'/'||:'nm','context.automation com botões, runId e nodeId');
select is(private.automation_verify_payload(:'s1'::jsonb#>>'{payloads,a1}')->>'nodeId',:'nm','payload do botão path é verificável');
select ok(not (:'s1'::jsonb->'payloads' ? 'u1'),'botão url não ganha payload');
select is(pg_temp.link(:'c1'),:'r1'::uuid,'conversa segue vinculada durante a espera');
select is(public.apply_automation_step(:'r1', :'t1', :'st1'::jsonb),:'s1'::jsonb,'replay do envio no Simulador devolve o resultado gravado (payloads)');
select is((select count(*)::int from public.messages where conversation_id=:'c1' and direction='outbound'),1,'replay do Simulador não reenvia');

-- clique: a resposta retoma a execução
select public.ingest_inbound_message('00000000-0000-0000-0000-000000004101','in41a','+5541000000001','Maria','Sim',now(),
  jsonb_build_object('payload', :'s1'::jsonb#>>'{payloads,a1}'));
select is((select input->>'optionId' from public.automation_runs where id=:'r1'),'a1','resposta grava a opção');
select public.claim_automation_runs(10) as cl2 \gset
select (select x->>'claimToken' from jsonb_array_elements(:'cl2'::jsonb) x where x->>'runId'=:'r1') as t1b \gset
select public.prepare_automation_run(:'r1', :'t1b') as p2 \gset
select is(:'p2'::jsonb->>'waitingFor','reply','prepare: waitingFor');
select is(:'p2'::jsonb#>>'{input,optionId}','a1','prepare: input com a opção');
select throws_ok(format($$select public.apply_automation_step(%L, %L, %L)$$, :'r1', :'t1b',
  pg_temp.step(:'ng', jsonb_build_object('next', :'nd'))),'22023',null,'espera não resolvida: 22023');
-- retomada: passo do nó de espera com o handle resolvido
select is(public.apply_automation_step(:'r1', :'t1b', pg_temp.step(:'nm', jsonb_build_object('next', :'ng'), '[]', 'opt:a1'))->>'state',
  'running','retomada segue pelo handle');
select is((select coalesce(waiting_for,'null')||'/'||coalesce(input::text,'null')||'/'||current_node_id::text from public.automation_runs where id=:'r1'),
  'null/null/'||:'ng','retomada limpa a espera e avança');
select is((select handle||'/'||status::text from public.automation_run_steps where run_id=:'r1' and node_id=:'nm'),'opt:a1/completed','passo da espera registra o handle');

-- efeitos de CRM: aplicados uma vez; replay idempotente
select public.apply_automation_step(:'r1', :'t1b', pg_temp.step(:'ng', jsonb_build_object('next', :'nd'),
  '[{"type":"add_tag","tagId":"00000000-0000-0000-0000-000000004111"},{"type":"move_stage","stageId":"00000000-0000-0000-0000-000000004123"}]')) as s2 \gset
select is((select count(*)::int from public.contact_tags where contact_id=:'k1'),1,'tag aplicada');
select is((select stage_id::text||'/'||status::text from public.deals where contact_id=:'k1'),'00000000-0000-0000-0000-000000004123/open','negócio garantido na etapa');
select is((select count(*)::int from public.events where contact_id=:'k1' and type='tag_added'),1,'um evento tag_added');
select is((select actor_type from public.events where contact_id=:'k1' and type='tag_added'),'automation','evento com ator automation');
select is(public.apply_automation_step(:'r1', :'t1b', pg_temp.step(:'ng', jsonb_build_object('next', :'nd'),
  '[{"type":"add_tag","tagId":"00000000-0000-0000-0000-000000004111"},{"type":"move_stage","stageId":"00000000-0000-0000-0000-000000004123"}]')),
  :'s2'::jsonb,'replay devolve o resultado gravado');
select is((select count(*)::int from public.events where contact_id=:'k1' and type='tag_added'),1,'replay não duplica tag_added');
select is((select count(*)::int from public.automation_run_steps where run_id=:'r1' and node_id=:'ng'),1,'replay não duplica o passo');
select is((select step_count from public.automation_runs where id=:'r1'),3,'replay não conta passo');
select isnt(current_setting('flowai.automation_actor', true),'on','ator automation desligado após o apply');
select is(public.apply_automation_step(:'r1', :'t1b', pg_temp.step(:'ng', jsonb_build_object('next', :'nd'),
  '[{"type":"add_tag","tagId":"00000000-0000-0000-0000-000000004112"}]', 'default', 0))->>'state','running','replay ignora efeitos diferentes');
select is((select count(*)::int from public.contact_tags where contact_id=:'k1'),1,'tag de outra org nunca aplicada');

-- espera de tempo
select is(public.apply_automation_step(:'r1', :'t1b', pg_temp.step(:'nd',
  jsonb_build_object('waitDelay', jsonb_build_object('until', now() + interval '10 minutes'))))->>'state','waiting','delay: aguarda');
select ok((select waiting_for='delay' and wait_node_id=current_node_id and current_node_id=pg_temp.n('d')
  and resume_at between now()+interval '599 seconds' and now()+interval '601 seconds' from public.automation_runs where id=:'r1'),'waitDelay: waiting/delay e resume_at');
select is((select attempts from public.automation_runs where id=:'r1'),0,'espera zera as tentativas');
-- fim
update public.automation_runs set resume_at=now()-interval '1 second' where id=:'r1';
select public.claim_automation_runs(10) as cl3 \gset
select (select x->>'claimToken' from jsonb_array_elements(:'cl3'::jsonb) x where x->>'runId'=:'r1') as t1c \gset
select is(public.apply_automation_step(:'r1', :'t1c', pg_temp.step(:'nd', jsonb_build_object('next', :'ne')))->>'state','running','delay vencido segue');
select is(public.apply_automation_step(:'r1', :'t1c', pg_temp.step(:'ne', '{"end":true}'))->>'state','completed','end conclui');
select is(pg_temp.link(:'c1'),null,'fim limpa o vínculo da conversa');
select is((select claim_token::text from public.automation_runs where id=:'r1'),null,'fim libera a reserva');

-- =============================================================== Instagram
select pg_temp.contact('6', null, 'ig6') as k6 \gset
select pg_temp.conv('6', '00000000-0000-0000-0000-000000004102') as c6 \gset
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status,created_at)
  values (:'oa',:'c6','00000000-0000-0000-0000-000000004102','inbound','contact','Oi','delivered',now());
select pg_temp.run('6', :'c6', :'k6', :'nm') as r6 \gset
select pg_temp.hold(:'r6') as t6 \gset
select public.automation_button_payloads(:'r6', :'t6', :'nm') as bp \gset
select is(private.automation_verify_payload(:'bp'::jsonb->>'a1')->>'runId',:'r6','button_payloads: payload verificável');
select is((select array_agg(k order by k) from jsonb_object_keys(:'bp'::jsonb) k),array['a1'],'button_payloads: só opções path');
select throws_ok(format($$select public.automation_button_payloads(%L, gen_random_uuid(), %L)$$, :'r6', :'nm'),'42501',null,'button_payloads com token errado: 42501');
select pg_temp.step(:'nm',
  jsonb_build_object('waitReply', jsonb_build_object('until', now() + interval '24 hours')),
  jsonb_build_array(jsonb_build_object('type','send_text','text','Escolha',
    'buttons', '[{"id":"a1","title":"Sim","kind":"path"}]'::jsonb,
    'instagram', jsonb_build_object('text','Escolha','quick_replies', jsonb_build_array(jsonb_build_object('content_type','text','title','Sim','payload', :'bp'::jsonb->>'a1'))))),
  null) as st6 \gset
select public.apply_automation_step(:'r6', :'t6', :'st6'::jsonb) as s6 \gset
select is(jsonb_array_length(:'s6'::jsonb->'intentIds'),1,'Instagram: um intent');
select is((select (message_payload#>>'{quick_replies,0,payload}')||'/'||automation_run_id::text||'/'||text||'/'||recipient_external_id||'/'||state
  from public.instagram_send_intents where id=(:'s6'::jsonb->'intentIds'->>0)::uuid),
  (:'bp'::jsonb->>'a1')||'/'||:'r6'||'/Escolha/ig6/pending','intent com message_payload, automation_run_id e destinatário');
select is((select m.sender_type::text||'/'||m.status::text from public.messages m join public.instagram_send_intents i on i.message_id=m.id
  where i.id=(:'s6'::jsonb->'intentIds'->>0)::uuid),'automation/pending','Instagram: mensagem pendente da automação');
select is(:'s6'::jsonb->>'state','waiting','Instagram: aguarda resposta');
select is(public.apply_automation_step(:'r6', :'t6', :'st6'::jsonb),:'s6'::jsonb,'replay Instagram devolve intentIds e payloads gravados');
select is((select count(*)::int from public.instagram_send_intents where conversation_id=:'c6'),1,'replay Instagram não cria intent');
select is((select count(*)::int from public.messages where conversation_id=:'c6' and direction='outbound'),1,'replay Instagram não cria mensagem');
select is(public.claim_instagram_send((:'s6'::jsonb->'intentIds'->>0)::uuid)->'messagePayload',
  (:'st6'::jsonb->'effects'->0->'instagram'),'claim de envio devolve o corpo completo com respostas rápidas');

-- texto acima de 1000 bytes no Instagram → reply_too_long, execução concluída, nada enviado
select pg_temp.contact('19', null, 'ig19') as k19 \gset
select pg_temp.conv('19', '00000000-0000-0000-0000-000000004102') as c19 \gset
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status,created_at)
  values (:'oa',:'c19','00000000-0000-0000-0000-000000004102','inbound','contact','Oi','delivered',now());
select pg_temp.run('19', :'c19', :'k19', :'nm') as r19 \gset
select pg_temp.hold(:'r19') as t19 \gset
select public.apply_automation_step(:'r19', :'t19', pg_temp.step(:'nm',
  jsonb_build_object('waitReply', jsonb_build_object('until', now() + interval '24 hours')),
  jsonb_build_array(jsonb_build_object('type','send_text','text',repeat('á',600),'instagram',jsonb_build_object('text',repeat('á',600)))),
  null)) as s19 \gset
select is((:'s19'::jsonb->>'result')||'/'||(:'s19'::jsonb->>'state'),'reply_too_long/completed','texto longo no Instagram: reply_too_long e concluída');
select is((select count(*)::int from public.messages where conversation_id=:'c19' and direction='outbound'),0,'texto longo: sem mensagem');
select is((select count(*)::int from public.instagram_send_intents where conversation_id=:'c19'),0,'texto longo: sem intent');

-- fora da janela de 24h → window_closed e execução concluída
select pg_temp.contact('7', null, 'ig7') as k7 \gset
select pg_temp.conv('7', '00000000-0000-0000-0000-000000004102') as c7 \gset
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status,created_at)
  values (:'oa',:'c7','00000000-0000-0000-0000-000000004102','inbound','contact','Oi','delivered',now()-interval '25 hours');
select pg_temp.run('7', :'c7', :'k7', :'nm') as r7 \gset
select pg_temp.hold(:'r7') as t7 \gset
select public.apply_automation_step(:'r7', :'t7', pg_temp.step(:'nm',
  jsonb_build_object('waitReply', jsonb_build_object('until', now() + interval '24 hours')),
  '[{"type":"send_text","text":"Escolha","instagram":{"text":"Escolha"}}]', null)) as s7 \gset
select is(:'s7'::jsonb->>'result','window_closed','fora da janela: resultado window_closed');
select is(:'s7'::jsonb->>'state','completed','fora da janela: execução concluída');
select is((select output->>'result' from public.automation_run_steps where run_id=:'r7'),'window_closed','passo grava window_closed');
select is((select count(*)::int from public.instagram_send_intents where conversation_id=:'c7'),0,'fora da janela: sem intent');
select is(pg_temp.link(:'c7'),null,'fora da janela: vínculo limpo');

-- =============================================================== limite de passos
select pg_temp.contact('8', '+5541000000008') as k8 \gset
select pg_temp.conv('8', '00000000-0000-0000-0000-000000004101') as c8 \gset
select pg_temp.run('8', :'c8', :'k8', :'nt') as r8 \gset
select pg_temp.hold(:'r8') as t8 \gset
update public.automation_runs set step_count=50 where id=:'r8';
select is(public.apply_automation_step(:'r8', :'t8', pg_temp.step(:'nt', jsonb_build_object('next', :'nm')))->>'state','failed','51º passo falha');
select is((select status::text||'/'||error from public.automation_runs where id=:'r8'),'failed/max_steps','execução failed com max_steps');
select is(pg_temp.link(:'c8'),null,'max_steps limpa o vínculo');
-- erro informado pelo worker no passo
select pg_temp.contact('16', '+5541000000016') as k16 \gset
select pg_temp.conv('16', '00000000-0000-0000-0000-000000004101') as c16 \gset
select pg_temp.run('16', :'c16', :'k16', :'nt') as r16 \gset
select pg_temp.hold(:'r16') as t16 \gset
select is(public.apply_automation_step(:'r16', :'t16', pg_temp.step(:'nt', jsonb_build_object('next', :'nm'))
  || '{"error":"Texto livre!"}'::jsonb)->>'state','failed','erro do worker no passo falha a execução');
select is((select status::text||'/'||error from public.automation_runs where id=:'r16'),'failed/invalid_code','erro do passo também passa pelo regex de código');

-- =============================================================== IA: cota esgotada → handoff (quota_exceeded)
select pg_temp.contact('9', '+5541000000009') as k9 \gset
select pg_temp.conv('9', '00000000-0000-0000-0000-000000004101') as c9 \gset
select pg_temp.run('9', :'c9', :'k9', :'nai') as r9 \gset
select pg_temp.hold(:'r9') as t9 \gset
select public.prepare_automation_run(:'r9', :'t9') as p9 \gset
select is(:'p9'::jsonb#>>'{ai,agent,name}','Lia','prepare: contexto de IA no bloco de IA');
select is(:'p9'::jsonb#>>'{ai,quotaLeft}','true','prepare: cota disponível');
insert into private.ai_limit_overrides(organization_id,daily_replies,daily_tests) values (:'oa',0,0);
select public.apply_automation_step(:'r9', :'t9', pg_temp.step(:'nai', jsonb_build_object('next', :'ne'), '[{"type":"ai_message"}]', 'sent')
  || '{"aiReply":{"text":"Olá!","usedChunkIds":[]}}'::jsonb) as s9 \gset
select is(:'s9'::jsonb->>'result','quota_exceeded','cota esgotada: resultado quota_exceeded');
select is(:'s9'::jsonb->>'currentNodeId',:'nh','cota esgotada: segue pela saída handoff');
select is((select handle from public.automation_run_steps where run_id=:'r9' and node_id=:'nai'),'handoff','passo registra handle handoff');
select is((select count(*)::int from public.messages where conversation_id=:'c9' and direction='outbound'),0,'cota esgotada: nada enviado');
-- handoff_human
select is(public.apply_automation_step(:'r9', :'t9', pg_temp.step(:'nh', jsonb_build_object('next', :'ne'), '[{"type":"handoff_human"}]'))->>'state','completed','handoff_human é terminal (ignora a saída)');
select is(pg_temp.st(:'r9')||'/'||coalesce(pg_temp.link(:'c9')::text,'null'),'completed/null','handoff_human: execução concluída e vínculo liberado');
select is((select status::text||'/'||handled_by::text from public.conversations where id=:'c9'),'pending_human/human','handoff_human: pending_human/human');
select is((select content from public.messages where conversation_id=:'c9' and sender_type='system'),'Automação transferiu para atendimento humano','texto de sistema da transferência');
delete from private.ai_limit_overrides where organization_id=:'oa';

-- IA com cota: envia como automação e consome
select pg_temp.contact('10', '+5541000000010') as k10 \gset
select pg_temp.conv('10', '00000000-0000-0000-0000-000000004101') as c10 \gset
select pg_temp.run('10', :'c10', :'k10', :'nai') as r10 \gset
select pg_temp.hold(:'r10') as t10 \gset
select coalesce((select replies from public.ai_usage_daily where organization_id=:'oa'),0) as used0 \gset
select public.apply_automation_step(:'r10', :'t10', pg_temp.step(:'nai', jsonb_build_object('next', :'ne'), '[{"type":"ai_message"}]', 'sent')
  || '{"aiReply":{"text":"Olá da IA","usedChunkIds":[]}}'::jsonb) as s10 \gset
select is((select sender_type::text||'/'||content from public.messages where conversation_id=:'c10' and direction='outbound'),'automation/Olá da IA','IA: mensagem enviada pela automação');
select is((select replies from public.ai_usage_daily where organization_id=:'oa'),:used0 + 1,'IA consome a cota');
select is(:'s10'::jsonb->>'currentNodeId',:'ne','IA enviada segue a rota do worker');
select is(public.apply_automation_step(:'r10', :'t10', pg_temp.step(:'nai', jsonb_build_object('next', :'ne'), '[{"type":"ai_message"}]', 'sent')
  || '{"aiReply":{"text":"Olá da IA","usedChunkIds":[]}}'::jsonb),:'s10'::jsonb,'replay da IA devolve o resultado gravado');
select is((select replies from public.ai_usage_daily where organization_id=:'oa'),:used0 + 1,'replay da IA não consome cota');
select is((select count(*)::int from public.messages where conversation_id=:'c10' and direction='outbound'),1,'replay da IA não reenvia');

-- canal do Instagram inativo: nada é consumido, execução termina com channel_unavailable
insert into public.channels(id,organization_id,type,name,status) values ('00000000-0000-0000-0000-000000004103',:'oa','instagram','IG41off','error');
select pg_temp.contact('20', null, 'ig20') as k20 \gset
select pg_temp.conv('20', '00000000-0000-0000-0000-000000004103') as c20 \gset
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status,created_at)
  values (:'oa',:'c20','00000000-0000-0000-0000-000000004103','inbound','contact','Oi','delivered',now());
select pg_temp.run('20', :'c20', :'k20', :'nai') as r20 \gset
select pg_temp.hold(:'r20') as t20 \gset
select public.apply_automation_step(:'r20', :'t20', pg_temp.step(:'nai', jsonb_build_object('next', :'ne'), '[{"type":"ai_message"}]', 'sent')
  || '{"aiReply":{"text":"Olá","usedChunkIds":[]}}'::jsonb) as s20 \gset
select is(:'s20'::jsonb->>'result','channel_unavailable','canal inativo: channel_unavailable');
select is((select replies from public.ai_usage_daily where organization_id=:'oa'),:used0 + 1,'canal inativo: cota não consumida');
select is(pg_temp.st(:'r20')||'/'||coalesce(pg_temp.link(:'c20')::text,'null'),'failed/null','canal inativo: execução termina e libera o vínculo');

-- handoff_ai, atribuição e fechamento
select is(public.apply_automation_step(:'r10', :'t10', pg_temp.step(:'ne', jsonb_build_object('next', :'ne'),
  jsonb_build_array(jsonb_build_object('type','assign_user','userId',:'uout'))))->>'state','running','atribuição a não-membro é ignorada');
select is((select assigned_to from public.conversations where id=:'c10'),null,'não-membro não é atribuído');
update public.automation_runs set current_node_id=:'nh' where id=:'r10';
select is(public.apply_automation_step(:'r10', :'t10', pg_temp.step(:'nh', jsonb_build_object('next', :'nd'),
  jsonb_build_array(jsonb_build_object('type','assign_user','userId',:'uag'), '{"type":"handoff_ai"}'::jsonb)))->>'state',
  'completed','handoff_ai é terminal (ignora a saída)');
select is((select assigned_to::text||'/'||handled_by::text||'/'||status::text||'/'||coalesce(automation_run_id::text,'null') from public.conversations where id=:'c10'),
  :'uag'||'/ai/open/null','assign_user e handoff_ai (vínculo limpo)');
select is(pg_temp.st(:'r10'),'completed','handoff_ai: execução concluída');
-- fechamento
select pg_temp.contact('17', '+5541000000017') as k17 \gset
select pg_temp.conv('17', '00000000-0000-0000-0000-000000004101') as c17 \gset
select pg_temp.run('17', :'c17', :'k17', :'nd') as r17 \gset
select pg_temp.hold(:'r17') as t17 \gset
select public.apply_automation_step(:'r17', :'t17', pg_temp.step(:'nd', '{"end":true}', '[{"type":"close_conversation"}]'));
select is((select status::text from public.conversations where id=:'c17'),'closed','close_conversation fecha');
select is(pg_temp.st(:'r17'),'completed','execução concluída após fechar');

-- conversa fechada entre passos: o próximo apply cancela (nunca fica aguardando)
select pg_temp.contact('21', '+5541000000021') as k21 \gset
select pg_temp.conv('21', '00000000-0000-0000-0000-000000004101') as c21 \gset
select pg_temp.run('21', :'c21', :'k21', :'nt') as r21 \gset
select pg_temp.hold(:'r21') as t21 \gset
select public.apply_automation_step(:'r21', :'t21', pg_temp.step(:'nt', jsonb_build_object('next', :'nm')));
update public.conversations set status='closed' where id=:'c21';
select public.apply_automation_step(:'r21', :'t21', pg_temp.step(:'nm',
  jsonb_build_object('waitReply', jsonb_build_object('until', now() + interval '24 hours')),
  '[{"type":"send_text","text":"Oi"}]', null)) as s21 \gset
select is((:'s21'::jsonb->>'state')||'/'||(:'s21'::jsonb->>'result'),'cancelled/conversation_closed','conversa fechada: cancelled/conversation_closed');
select is((select status::text||'/'||coalesce(waiting_for,'null') from public.automation_runs where id=:'r21'),'cancelled/null','conversa fechada: execução não fica aguardando');
select is((select status::text from public.automation_run_steps where run_id=:'r21' and node_id=:'nm'),'cancelled','conversa fechada: passo cancelado');
select is((select count(*)::int from public.messages where conversation_id=:'c21' and direction='outbound' and sender_type='automation'),0,'conversa fechada: nada enviado');

-- contato excluído com execução em curso → cancelada; prepare skip
select pg_temp.contact('18', '+5541000000018') as k18 \gset
select pg_temp.run('18', null, :'k18', :'nt') as r18 \gset
select pg_temp.hold(:'r18') as t18 \gset
delete from public.contacts where id=:'k18';
select is(pg_temp.st(:'r18'),'cancelled','excluir o contato cancela a execução em curso');
select is(public.prepare_automation_run(:'r18', :'t18')->>'action','skip','prepare: contato excluído → skip');

-- =============================================================== execuções sem conversa (nível de contato)
select pg_temp.contact('11', '+5541000000011') as k11 \gset
select pg_temp.run('11', null, :'k11', :'nm') as r11 \gset
select pg_temp.hold(:'r11') as t11 \gset
select public.apply_automation_step(:'r11', :'t11', pg_temp.step(:'nm',
  jsonb_build_object('next', :'ng'), '[{"type":"send_text","text":"Oi"}]', null)) as s11 \gset
select is(:'s11'::jsonb->>'result','no_conversation','sem conversa: envio pulado');
select is(:'s11'::jsonb->>'state','running','sem conversa: execução segue');
select is(public.apply_automation_step(:'r11', :'t11', pg_temp.step(:'ng', jsonb_build_object('next', :'nd'),
  '[{"type":"add_tag","tagId":"00000000-0000-0000-0000-000000004111"}]'))->>'state','running','sem conversa: CRM aplica');
select is((select count(*)::int from public.contact_tags where contact_id=:'k11'),1,'sem conversa: tag aplicada');
-- conversa aberta e livre → vinculada e envio feito
select pg_temp.contact('12', '+5541000000012') as k12 \gset
select pg_temp.conv('12', '00000000-0000-0000-0000-000000004101') as c12 \gset
select pg_temp.run('12', null, :'k12', :'nm') as r12 \gset
select pg_temp.hold(:'r12') as t12 \gset
select public.apply_automation_step(:'r12', :'t12', pg_temp.step(:'nm', jsonb_build_object('next', :'ng'), '[{"type":"send_text","text":"Oi"}]', null)) as s12 \gset
select is((select conversation_id from public.automation_runs where id=:'r12'),:'c12'::uuid,'conversa livre é ligada à execução');
select is(pg_temp.link(:'c12'),:'r12'::uuid,'conversa livre vinculada');
select is((select count(*)::int from public.messages where conversation_id=:'c12' and sender_type='automation'),1,'envio feito na conversa ligada');
-- conversa ocupada → conversation_busy
select pg_temp.contact('13', '+5541000000013') as k13 \gset
select pg_temp.conv('13', '00000000-0000-0000-0000-000000004101') as c13 \gset
select pg_temp.run('13b', :'c13', :'k13', :'nt') as r13b \gset
select pg_temp.run('13', null, :'k13', :'nm') as r13 \gset
select pg_temp.hold(:'r13') as t13 \gset
select is(public.apply_automation_step(:'r13', :'t13', pg_temp.step(:'nm', jsonb_build_object('next', :'ng'), '[{"type":"send_text","text":"Oi"}]', null))->>'result',
  'conversation_busy','conversa ocupada: envio pulado');
select is((select conversation_id from public.automation_runs where id=:'r13'),null,'conversa ocupada não é ligada');
select is(pg_temp.link(:'c13'),:'r13b'::uuid,'vínculo da outra execução intacto');

-- =============================================================== falhas e backoff
select pg_temp.contact('14', '+5541000000014') as k14 \gset
select pg_temp.conv('14', '00000000-0000-0000-0000-000000004101') as c14 \gset
select pg_temp.run('14', :'c14', :'k14', :'nt') as r14 \gset
select pg_temp.hold(:'r14') as t14 \gset
select public.fail_automation_run(:'r14', :'t14', 'webhook_timeout', true);
select is((select status::text||'/'||error||'/'||(claim_token is null)::text from public.automation_runs where id=:'r14'),'pending/webhook_timeout/true','retentável: volta a pending');
select ok((select resume_at between now()+interval '9 seconds' and now()+interval '11 seconds' from public.automation_runs where id=:'r14'),'backoff de 10 s');
select is(pg_temp.link(:'c14'),:'r14'::uuid,'retentável mantém o vínculo');
select pg_temp.hold(:'r14') as t14b \gset
select public.fail_automation_run(:'r14', :'t14b', 'webhook_timeout', true);
select ok((select resume_at between now()+interval '29 seconds' and now()+interval '31 seconds' from public.automation_runs where id=:'r14'),'backoff de 30 s');
select pg_temp.hold(:'r14') as t14c \gset
select public.fail_automation_run(:'r14', :'t14c', 'webhook_timeout', true);
select is(pg_temp.st(:'r14'),'failed','3ª tentativa esgota: failed');
select is(pg_temp.link(:'c14'),null,'desistência limpa o vínculo (IA volta)');
select pg_temp.contact('15', '+5541000000015') as k15 \gset
select pg_temp.conv('15', '00000000-0000-0000-0000-000000004101') as c15 \gset
select pg_temp.run('15', :'c15', :'k15', :'nt') as r15 \gset
select pg_temp.hold(:'r15') as t15 \gset
select public.fail_automation_run(:'r15', :'t15', 'Texto da mensagem: oi!', false);
select is((select status::text||'/'||error from public.automation_runs where id=:'r15'),'failed/invalid_code','código inseguro vira invalid_code');

-- =============================================================== reexecução
select tests.authenticate_as(:'uag');
select throws_ok(format($$select public.rerun_automation_from(%L, %L)$$, :'r1', :'ng'),'42501',null,'agent não reexecuta');
select tests.authenticate_as(:'uout');
select throws_ok(format($$select public.rerun_automation_from(%L, %L)$$, :'r1', :'ng'),'P0002',null,'outra org não enxerga a execução');
select tests.authenticate_as(:'ua');
select throws_ok(format($$select public.rerun_automation_from(%L, %L)$$, :'r6', :'ng'),'22023',null,'execução em espera não é reexecutada');
select throws_ok(format($$select public.rerun_automation_from(%L, %L)$$, :'r1', gen_random_uuid()),'22023',null,'nó fora da versão: 22023');
select is(public.rerun_automation_from(:'r1', :'ng'),1,'admin reexecuta: nova iteração');
select tests.clear_authentication();
select is((select status::text||'/'||current_node_id::text||'/'||step_count||'/'||coalesce(error,'null') from public.automation_runs where id=:'r1'),
  'pending/'||:'ng'||'/0/null','reexecução: pending no nó escolhido');
select is(pg_temp.link(:'c1'),:'r1'::uuid,'reexecução revincula a conversa livre');
select pg_temp.hold(:'r1') as t1d \gset
select public.apply_automation_step(:'r1', :'t1d', pg_temp.step(:'ng', jsonb_build_object('next', :'nd'), '[]', 'default', 1));
select is((select count(*)::int from public.automation_run_steps where run_id=:'r1' and node_id=:'ng'),2,'nova iteração grava novo passo');

-- execução em espera termina: o passo que aguardava fica cancelado
update public.conversations set status='closed' where id=:'c6';
select is(pg_temp.st(:'r6'),'cancelled','fechar a conversa cancela a execução em espera');
select is((select status::text from public.automation_run_steps where run_id=:'r6' and node_id=:'nm'),'cancelled','passo em espera fica cancelado');
select pg_temp.contact('22', '+5541000000022') as k22 \gset
select pg_temp.conv('22', '00000000-0000-0000-0000-000000004101') as c22 \gset
select pg_temp.run('22', :'c22', :'k22', :'nd') as r22 \gset
select pg_temp.hold(:'r22') as t22 \gset
select public.apply_automation_step(:'r22', :'t22', pg_temp.step(:'nd', jsonb_build_object('waitDelay', jsonb_build_object('until', now()))));
select pg_temp.hold(:'r22') as t22b \gset
select public.fail_automation_run(:'r22', :'t22b', 'boom', false);
select is((select status::text from public.automation_run_steps where run_id=:'r22' and node_id=:'nd'),'cancelled','desistência na retomada cancela o passo em espera');

-- =============================================================== dispatch
update public.automation_runs set status='cancelled', claim_token=null where status in ('pending','waiting','running');
select count(*)::int as h0 from net.http_request_queue \gset
select lives_ok($$select public.dispatch_automation_worker()$$,'dispatch sem config não falha');
select is((select count(*)::int from net.http_request_queue),:h0,'sem config: nenhuma chamada');
select public.configure_automation_worker('http://kong:8000', repeat('k',40), repeat('w',40));
select is(public.read_automation_worker_config()->>'workerSecret',repeat('w',40),'config do worker lida do Vault');
select public.dispatch_automation_worker();
select is((select count(*)::int from net.http_request_queue),:h0,'sem execução vencida: nenhuma chamada');
update public.automation_runs set status='pending', resume_at=now()-interval '1 second' where id=:'r15';
select public.dispatch_automation_worker();
select is((select count(*)::int from net.http_request_queue),:h0 + 1,'execução vencida chama o worker');
select ok((select url like '%/functions/v1/automation-worker' and headers ? 'X-FlowAI-Worker' from net.http_request_queue order by id desc limit 1),
  'requisição vai para o automation-worker com o header');

-- =============================================================== varredura isolada por linha
update public.automation_runs set status='cancelled' where id=:'r15';
update public.automation_runs set status='running', attempts=3, claim_token=gen_random_uuid(), claimed_until=now()-interval '2 seconds' where id=:'r14';
update public.automation_runs set status='running', attempts=1, claim_token=gen_random_uuid(), claimed_until=now()-interval '1 second' where id=:'r15';
create or replace function private.automation_release(p_run uuid) returns void
language plpgsql as $$ begin raise exception 'boom'; end $$;
select lives_ok($$select public.sweep_automation_runs()$$,'sweep sobrevive a linha com erro');
select is(pg_temp.st(:'r14'),'running','linha com erro permanece como estava');
select is((select status::text||'/'||error from public.automation_runs where id=:'r15'),'pending/claim_expired','reserva vencida vira falha retentável');

-- Budget yield is not a failed attempt; preserve prior genuine failures and all progress.
select has_function('public','yield_automation_run',array['uuid','uuid'],'yield RPC existe');
select ok(not coalesce(has_function_privilege('anon',to_regprocedure('public.yield_automation_run(uuid,uuid)'),'execute'),true),'anon não executa yield');
select ok(not coalesce(has_function_privilege('authenticated',to_regprocedure('public.yield_automation_run(uuid,uuid)'),'execute'),true),'authenticated não executa yield');
select ok(coalesce(has_function_privilege('service_role',to_regprocedure('public.yield_automation_run(uuid,uuid)'),'execute'),false),'service_role executa yield');
select ok(coalesce((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
  where p.oid=to_regprocedure('public.yield_automation_run(uuid,uuid)')),false),'yield definer com search_path vazio');
select pg_temp.contact('25', '+5541000000025') as k25 \gset
select pg_temp.conv('25', '00000000-0000-0000-0000-000000004101') as c25 \gset
select pg_temp.run('25', :'c25', :'k25', :'nm') as r25 \gset
update public.automation_runs set attempts=1, step_count=17, iteration=3, waiting_for='reply', wait_node_id=:'nm',
  input='{"optionId":"a1","text":null}'::jsonb, error='webhook_timeout' where id=:'r25';
create function pg_temp.claim_for(p_run uuid) returns uuid language sql as $$
  select (x->>'claimToken')::uuid from jsonb_array_elements(public.claim_automation_runs(50)) x where x->>'runId'=p_run::text $$;
select pg_temp.claim_for(:'r25') as t25 \gset
select throws_ok(format($$select public.yield_automation_run(%L, gen_random_uuid())$$, :'r25'),'42501',null,'yield token antigo: reserva perdida');
select is((select status::text||'/'||attempts from public.automation_runs where id=:'r25'),'running/2','token antigo mantém status e tentativas');
select throws_ok(format($$select public.yield_automation_run(%L, null)$$, :'r25'),'42501',null,'yield token nulo: reserva perdida');
select lives_ok(format($body$do $yield$ declare t uuid := %L; i int; begin
  for i in 1..4 loop
    perform public.yield_automation_run(%L, t);
    if not exists(select 1 from public.automation_runs where id=%L and status='pending' and attempts=1
        and resume_at<=now() and claim_token is null and claimed_until is null) then raise exception 'yield charged failure'; end if;
    t := pg_temp.claim_for(%L);
    if t is null then raise exception 'yield not immediately reclaimable'; end if;
  end loop;
end; $yield$;$body$, :'t25', :'r25', :'r25', :'r25'),'quatro yields e claims sem gastar tentativas');
select is((select current_node_id::text||'/'||step_count||'/'||iteration||'/'||waiting_for::text||'/'||wait_node_id::text||'/'||(input->>'optionId')
  from public.automation_runs where id=:'r25'),:'nm'||'/17/3/reply/'||:'nm'||'/a1','yield preserva nó, contador, iteração e entrada/espera');
select is(pg_temp.link(:'c25'),:'r25'::uuid,'yield preserva vínculo da conversa');
select public.fail_automation_run(:'r25', (select claim_token from public.automation_runs where id=:'r25'), 'webhook_timeout', true);
select is((select status::text||'/'||attempts||'/'||error from public.automation_runs where id=:'r25'),'pending/2/webhook_timeout','falha real após yields mantém contagem correta');
select ok((select resume_at between now()+interval '29 seconds' and now()+interval '31 seconds' from public.automation_runs where id=:'r25'),'falha real continua backoff de segunda tentativa');
select throws_ok(format($$select public.yield_automation_run(%L, %L)$$, :'r25', :'t25'),'42501',null,'yield não libera execução sem reserva running');
select * from finish();
rollback;
