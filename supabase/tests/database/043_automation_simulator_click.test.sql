begin;
create extension if not exists pgtap with schema extensions;
select plan(33);
select tests.create_user('owner43@t.test','Dona Ana') as ua \gset
select tests.create_user('agent43@t.test','Beto Agente') as uag \gset
select tests.create_user('viewer43@t.test','Vera Viewer') as uv \gset
select tests.create_user('out43@t.test','Fora') as uout \gset
select tests.create_org(:'ua','Org43A') as oa \gset
select tests.create_org(:'uout','Org43B') as ob \gset
select tests.add_member(:'oa',:'uag','agent');
select tests.add_member(:'oa',:'uv','viewer');

insert into public.channels(id,organization_id,type,name,status) values
  ('00000000-0000-0000-0000-000000004301',:'oa','simulator','Sim43','active'),
  ('00000000-0000-0000-0000-000000004302',:'oa','instagram','IG43','active');

create function pg_temp.n(p_k text) returns uuid language sql as $$ select md5('043' || p_k)::uuid $$;
select pg_temp.n('auto') as auto, pg_temp.n('m') as nm \gset
insert into public.automations (id, organization_id, name, trigger_type, trigger_config, status, activated_at, current_version)
  values (:'auto', :'oa', 'Qualificar', 'contact_created', '{}', 'paused', now(), 1);
insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph)
  values (:'oa', :'auto', 1, 'contact_created', '{}', jsonb_build_object(
    'nodes', jsonb_build_array(
      jsonb_build_object('id', pg_temp.n('t'), 'type', 'trigger', 'config', '{}'::jsonb, 'position', '{"x":0,"y":0}'::jsonb),
      jsonb_build_object('id', pg_temp.n('m'), 'type', 'message', 'position', '{"x":0,"y":0}'::jsonb, 'config',
        '{"mode":"text","text":"Escolha","replyTimeoutHours":24,"buttons":[{"id":"a1","title":"Quero","kind":"path"},{"id":"u1","title":"Site","kind":"url","url":"https://exemplo.com.br"}]}'::jsonb),
      jsonb_build_object('id', pg_temp.n('q'), 'type', 'message', 'position', '{"x":0,"y":0}'::jsonb, 'config',
        '{"mode":"text","text":"Pode ser?","replyTimeoutHours":24,"quickReplies":[{"id":"q1","title":"Sim"},{"id":"q2","title":"Não"}]}'::jsonb)),
    'edges', jsonb_build_array(jsonb_build_object('id', pg_temp.n('e1'), 'source', pg_temp.n('t'), 'target', pg_temp.n('m'),
      'sourceHandle', 'default'))));

-- contato + conversa + execução aguardando clique no nó m + mensagem da automação com os botões
create function pg_temp.setup(p_k text, p_channel uuid, p_phone text, p_ig text, p_node text default 'm') returns uuid
language plpgsql as $$
declare v_org uuid := (select id from public.organizations where name = 'Org43A'); v_event uuid; v_msg uuid;
  v_node uuid := pg_temp.n(p_node);
  v_buttons jsonb := case when p_node = 'm' then '[{"id":"a1","title":"Quero","kind":"path"},{"id":"u1","title":"Site","kind":"url","url":"https://exemplo.com.br"}]'::jsonb else '[]'::jsonb end;
  v_quick jsonb := case when p_node = 'q' then '[{"id":"q1","title":"Sim"},{"id":"q2","title":"Não"}]'::jsonb else '[]'::jsonb end;
begin
  insert into public.contacts(id, organization_id, name, phone, instagram_id)
    values (pg_temp.n('k' || p_k), v_org, 'Maria Silva', p_phone, p_ig);
  insert into public.conversations(id, organization_id, contact_id, channel_id)
    values (pg_temp.n('c' || p_k), v_org, pg_temp.n('k' || p_k), p_channel);
  insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, payload)
    values (v_org, 'automation_trigger', pg_temp.n('c' || p_k), pg_temp.n('k' || p_k), 'system', '{}') returning id into v_event;
  insert into public.automation_runs (id, organization_id, automation_id, trigger_event_id, conversation_id, contact_id,
      status, current_node_id, resume_at, version, waiting_for, wait_node_id)
    values (pg_temp.n('r' || p_k), v_org, pg_temp.n('auto'), v_event, pg_temp.n('c' || p_k), pg_temp.n('k' || p_k),
      'waiting', v_node, now() + interval '1 day', 1, 'reply', v_node);
  perform private.automation_link_run(pg_temp.n('c' || p_k), pg_temp.n('r' || p_k));
  insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status, context)
    values (v_org, pg_temp.n('c' || p_k), p_channel, 'outbound', 'automation', 'Escolha', 'delivered',
      jsonb_build_object('automation', jsonb_build_object('runId', pg_temp.n('r' || p_k), 'nodeId', v_node,
        'buttons', v_buttons, 'quickReplies', v_quick)))
    returning id into v_msg;
  return v_msg;
end $$;
select pg_temp.setup('s', '00000000-0000-0000-0000-000000004301', '5511999990043', null) as msg_sim \gset
select pg_temp.setup('i', '00000000-0000-0000-0000-000000004302', null, 'ig-43') as msg_ig \gset
-- segundo contato com o MESMO telefone (mais novo): a busca por telefone acharia o contato 's'
select pg_temp.setup('d', '00000000-0000-0000-0000-000000004301', '5511999990043', null) as msg_dup \gset
update public.contacts set created_at = now() + interval '1 minute' where id = pg_temp.n('kd');
select pg_temp.setup('q', '00000000-0000-0000-0000-000000004301', '5511999990044', null, 'q') as msg_quick \gset
select pg_temp.setup('x', '00000000-0000-0000-0000-000000004301', '5511999990045', null) as msg_stale \gset
-- execução vencida (prazo do clique expirado) ainda em 'waiting': passa na verificação rápida, o ingest recusa
update public.automation_runs set resume_at = now() - interval '1 minute' where id = pg_temp.n('rx');
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, status, context)
  values (:'oa', pg_temp.n('cs'), '00000000-0000-0000-0000-000000004301', 'outbound', 'automation', 'Velha', 'delivered',
    '{"automation":{"runId":"xyz","nodeId":"abc","buttons":[{"id":"a1","title":"Quero","kind":"path"}],"quickReplies":[]}}')
  returning id as msg_bad \gset
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, sender_user_id, content, status)
  values (:'oa', pg_temp.n('cs'), '00000000-0000-0000-0000-000000004301', 'outbound', 'human', :'ua', 'Oi', 'delivered')
  returning id as msg_human \gset

-- =============================================================== permissões
select has_function('public','click_automation_button',array['uuid','text'],'click_automation_button existe');
select ok(has_function_privilege('authenticated','public.click_automation_button(uuid,text)','execute'),'authenticated executa');
select ok(not has_function_privilege('anon','public.click_automation_button(uuid,text)','execute'),'anon não executa');

select tests.authenticate_as(:'uv');
select throws_ok(format('select public.click_automation_button(%L, %L)', :'msg_sim', 'a1'), '42501', null, 'viewer não clica');
select tests.authenticate_as(:'uout');
select throws_ok(format('select public.click_automation_button(%L, %L)', :'msg_sim', 'a1'), '42501', null, 'membro de outra organização não clica');

-- =============================================================== validações
select tests.authenticate_as(:'uag');
select throws_ok(format('select public.click_automation_button(%L, %L)', :'msg_ig', 'a1'), '22023', 'not_simulator',
  'conversa do Instagram não aceita clique simulado');
select throws_ok(format('select public.click_automation_button(%L, %L)', :'msg_sim', 'zz'), '22023', 'unknown_option',
  'opção desconhecida');
select throws_ok(format('select public.click_automation_button(%L, %L)', :'msg_sim', 'u1'), '22023', 'unknown_option',
  'botão de link não é clicável');
select throws_ok(format('select public.click_automation_button(%L, %L)', :'msg_human', 'a1'), '22023', 'unknown_option',
  'mensagem sem automação');
select throws_ok(format('select public.click_automation_button(%L, %L)', gen_random_uuid(), 'a1'), '42501', null,
  'mensagem inexistente');

-- =============================================================== clique do agente
select lives_ok(format('select public.click_automation_button(%L, %L)', :'msg_sim', 'a1'), 'agente clica no Simulador');
select is(auth.role(), 'authenticated', 'papel da sessão restaurado após o clique');
select tests.clear_authentication();
select is((select content from public.messages where conversation_id = pg_temp.n('cs') and direction = 'inbound'
  and sender_type = 'contact'), 'Quero', 'mensagem do contato com o título da opção');
select is((select context ->> 'origin' from public.messages where conversation_id = pg_temp.n('cs') and direction = 'inbound'),
  'button', 'context.origin = button');
select is((select context ->> 'payload' from public.messages where conversation_id = pg_temp.n('cs') and direction = 'inbound'),
  private.automation_payload(pg_temp.n('rs'), pg_temp.n('m'), 'a1'), 'context.payload assinado');
select is((select input from public.automation_runs where id = pg_temp.n('rs')),
  '{"optionId":"a1","text":"Quero"}'::jsonb, 'execução retomada com a opção');
select ok((select resume_at <= now() from public.automation_runs where id = pg_temp.n('rs')), 'execução vencida para o worker');
select is((select count(*)::int from public.events where conversation_id = pg_temp.n('cs') and type = 'button_clicked'
  and payload ->> 'optionId' = 'a1'), 1, 'evento button_clicked registrado');
select is((select count(*)::int from public.ai_jobs where conversation_id = pg_temp.n('cs')), 0, 'IA não é enfileirada');

-- segundo clique: a execução não aguarda mais
select tests.authenticate_as(:'uag');
select throws_ok(format('select public.click_automation_button(%L, %L)', :'msg_sim', 'a1'), '22023', 'not_waiting',
  'clique repetido não está mais disponível');

-- execução parada: o botão expira
select tests.clear_authentication();
update public.automation_runs set input = null where id = pg_temp.n('rs');
select tests.authenticate_as(:'ua');
select public.stop_automation(pg_temp.n('cs'));
select throws_ok(format('select public.click_automation_button(%L, %L)', :'msg_sim', 'a1'), '22023', 'not_waiting',
  'execução cancelada não aceita clique');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where conversation_id = pg_temp.n('cs') and direction = 'inbound'), 1,
  'cliques recusados não gravam mensagens');

-- =============================================================== núcleo do ingest e casos extras
select has_function('private','ingest_inbound_core',
  array['uuid','uuid','channel_type','text','text','text','text','timestamp with time zone','jsonb','uuid'], 'núcleo do ingest existe');
select is(has_function_privilege('authenticated',
  to_regprocedure('private.ingest_inbound_core(uuid,uuid,public.channel_type,text,text,text,text,timestamptz,jsonb,uuid)'), 'execute'),
  false, 'authenticated não executa o núcleo do ingest');
select ok(pg_get_functiondef('public.click_automation_button(uuid,text)'::regprocedure) !~* '(set_config|request\.jwt)',
  'clique não manipula o papel da sessão');

select tests.authenticate_as(:'uag');
select lives_ok(format('select public.click_automation_button(%L, %L)', :'msg_dup', 'a1'), 'contato com telefone repetido clica');
select lives_ok(format('select public.click_automation_button(%L, %L)', :'msg_quick', 'q2'), 'resposta rápida é clicável');
select throws_ok(format('select public.click_automation_button(%L, %L)', :'msg_stale', 'a1'), '22023', 'not_waiting',
  'clique recusado pelo ingest (prazo expirado) não está mais disponível');
select throws_ok(format('select public.click_automation_button(%L, %L)', :'msg_bad', 'a1'), '22023', 'not_waiting',
  'context com ids malformados não gera 22P02');
select tests.clear_authentication();
select is((select input from public.automation_runs where id = pg_temp.n('rd')), '{"optionId":"a1","text":"Quero"}'::jsonb,
  'execução do contato com telefone repetido retomada');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.n('cd') and direction = 'inbound'), 1,
  'mensagem gravada na conversa do contato clicado');
select is((select input from public.automation_runs where id = pg_temp.n('rq')), '{"optionId":"q2","text":"Não"}'::jsonb,
  'execução retomada com a resposta rápida');
select is((select count(*)::int from public.messages where conversation_id = pg_temp.n('cx') and direction = 'inbound'), 0,
  'clique recusado pelo ingest não grava mensagem');

select * from finish();
rollback;
