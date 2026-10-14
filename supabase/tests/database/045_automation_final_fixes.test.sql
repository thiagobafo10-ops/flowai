begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Fase 7A, onda final de correções (20261013000009_automation_final_fixes.sql).
select tests.create_user('owner45@t.test','Dona Ana') as ua \gset
select tests.create_user('agent45@t.test','Beto Agente') as uag \gset
select tests.create_org(:'ua','Org45') as oa \gset
select tests.add_member(:'oa',:'uag','agent');
insert into public.ai_agents(organization_id,name,personality,objective,tone,system_prompt,is_active,auto_reply,human_handoff)
  values (:'oa','Lia','Simpática','Vender','cordial','Seja breve',true,true,false);
insert into public.channels(id,organization_id,type,name,status) values
  ('00000000-0000-0000-0000-000000004501',:'oa','simulator','Sim45','active');
\set sim '00000000-0000-0000-0000-000000004501'
insert into public.tags(id,organization_id,name) values ('00000000-0000-0000-0000-000000004511',:'oa','vip');

create function pg_temp.n(p_k text) returns uuid language sql as $$ select md5('045' || p_k)::uuid $$;
select pg_temp.n('t') as nt, pg_temp.n('m') as nm, pg_temp.n('p') as np, pg_temp.n('e') as ne, pg_temp.n('ha') as nha,
  pg_temp.n('hh') as nhh, pg_temp.n('cc') as ncc, pg_temp.n('auto') as auto, pg_temp.n('kw') as kw, pg_temp.n('crm') as crm \gset
create function pg_temp.node(p_k text, p_type text, p_cfg jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', pg_temp.n(p_k), 'type', p_type, 'config', p_cfg, 'position', '{"x":0,"y":0}'::jsonb) $$;
create function pg_temp.edge(p_k text, p_s text, p_t text, p_h text) returns jsonb language sql as $$
  select jsonb_build_object('id', pg_temp.n(p_k), 'source', pg_temp.n(p_s), 'target', pg_temp.n(p_t), 'sourceHandle', p_h) $$;
-- fluxo pausado (só execuções criadas à mão): espera com resposta rápida, mensagem simples, transferências e fechamento
insert into public.automations (id, organization_id, name, trigger_type, trigger_config, status, activated_at, current_version)
  values (:'auto', :'oa', 'Fluxo 45', 'contact_created', '{}', 'paused', now(), 1);
insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph)
  values (:'oa', :'auto', 1, 'contact_created', '{}', jsonb_build_object(
    'nodes', jsonb_build_array(
      pg_temp.node('t','trigger','{}'),
      pg_temp.node('m','message','{"mode":"text","text":"Escolha","replyTimeoutHours":24,"quickReplies":[{"id":"a1","title":"Sim"}]}'),
      pg_temp.node('p','message','{"mode":"text","text":"Obrigado","replyTimeoutHours":24}'),
      pg_temp.node('ha','handoff_ai','{}'), pg_temp.node('hh','handoff_human','{}'),
      pg_temp.node('cc','close_conversation','{}'), pg_temp.node('e','end','{}')),
    'edges', jsonb_build_array(
      pg_temp.edge('e1','t','m','default'), pg_temp.edge('e2','m','p','opt:a1'), pg_temp.edge('e3','m','e','no_reply'),
      pg_temp.edge('e4','p','e','default'), pg_temp.edge('e5','cc','e','default'))));

create function pg_temp.contact(p_k text) returns uuid language sql as $$
  insert into public.contacts(id, organization_id, name, phone)
    values (pg_temp.n('k' || p_k), (select id from public.organizations where name = 'Org45'), 'Maria Silva', '+55410450' || p_k)
    returning id $$;
create function pg_temp.conv(p_k text, p_handled text default 'ai', p_status text default 'open') returns uuid language sql as $$
  insert into public.conversations(id, organization_id, contact_id, channel_id, handled_by, status)
    values (pg_temp.n('c' || p_k), (select id from public.organizations where name = 'Org45'), pg_temp.n('k' || p_k),
      '00000000-0000-0000-0000-000000004501', p_handled::public.handler_type, p_status::public.conversation_status)
    returning id $$;
create function pg_temp.run(p_k text, p_node uuid) returns uuid language plpgsql as $$
declare v_event uuid; v_run uuid; v_org uuid := (select id from public.organizations where name = 'Org45');
begin
  insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, payload)
    values (v_org, 'automation_trigger', pg_temp.n('c' || p_k), pg_temp.n('k' || p_k), 'system', '{}') returning id into v_event;
  insert into public.automation_runs (id, organization_id, automation_id, trigger_event_id, conversation_id, contact_id,
      status, current_node_id, resume_at, version)
    values (pg_temp.n('r' || p_k), v_org, pg_temp.n('auto'), v_event, pg_temp.n('c' || p_k), pg_temp.n('k' || p_k),
      'pending', p_node, now(), 1)
    returning id into v_run;
  perform private.automation_link_run(pg_temp.n('c' || p_k), v_run);
  return v_run;
end $$;
-- execução aguardando resposta no nó m (como deixam o worker e link_instagram_comment_run)
create function pg_temp.waiting(p_k text) returns uuid language plpgsql as $$
declare v_run uuid := pg_temp.run(p_k, pg_temp.n('m'));
begin
  update public.automation_runs set status = 'waiting', waiting_for = 'reply', wait_node_id = pg_temp.n('m'),
    resume_at = now() + interval '1 hour', step_count = 1 where id = v_run;
  insert into public.automation_run_steps (organization_id, run_id, node_id, iteration, status, output)
    values ((select organization_id from public.automation_runs where id = v_run), v_run, pg_temp.n('m'), 0, 'waiting',
      '{"result":"sent"}');
  return v_run;
end $$;
create function pg_temp.hold(p_run uuid) returns uuid language sql as $$
  update public.automation_runs set status = 'running', attempts = attempts + 1, claim_token = gen_random_uuid(),
    claimed_until = now() + interval '3 minutes' where id = p_run returning claim_token $$;
create function pg_temp.step(p_node uuid, p_route jsonb, p_effects jsonb default '[]', p_handle text default 'default')
  returns jsonb language sql as $$
  select jsonb_build_object('nodeId', p_node, 'iteration', 0, 'handle', p_handle, 'effects', p_effects, 'route', p_route) $$;
create function pg_temp.inbound(p_k text, p_text text, p_at timestamptz default now(), p_context jsonb default '{}') returns uuid
  language sql as $$
  select public.ingest_inbound_message('00000000-0000-0000-0000-000000004501', 'in' || p_k || md5(random()::text),
    '+55410450' || p_k, null, p_text, p_at, p_context) $$;
create function pg_temp.outbound(p_k text, p_at timestamptz) returns void language sql as $$
  insert into public.messages(organization_id, conversation_id, channel_id, direction, sender_type, content, status, created_at)
    values ((select id from public.organizations where name = 'Org45'), pg_temp.n('c' || p_k),
      '00000000-0000-0000-0000-000000004501', 'outbound', 'automation', 'Resposta anterior', 'delivered', p_at) $$;
create function pg_temp.ai_pending(p_k text) returns int language sql as $$
  select count(*)::int from public.ai_jobs where conversation_id = pg_temp.n('c' || p_k) and kind = 'reply' and state = 'pending' $$;

-- =============================================================== 1. falha registrada com o próprio código (contrato REST)
select pg_temp.contact('01') as k01 \gset
select pg_temp.conv('01') as c01 \gset
select pg_temp.run('01', :'nt') as r01 \gset
select pg_temp.hold(:'r01') as t01 \gset
-- argumentos nomeados, como o PostgREST chama a função
select public.fail_automation_run(p_run => :'r01', p_token => :'t01', p_code => 'webhook_blocked_address', p_retryable => false);
select is((select status::text || '/' || error from public.automation_runs where id = :'r01'), 'failed/webhook_blocked_address',
  'falha não retentável registrada com o próprio código');
select is((select automation_run_id from public.conversations where id = :'c01'), null::uuid, 'falha libera a conversa');

-- =============================================================== 2. IA não responde por cima de uma execução
select pg_temp.contact('02') as k02 \gset
select pg_temp.conv('02') as c02 \gset
insert into public.ai_jobs (organization_id, kind, conversation_id, state, claim_token, claimed_until)
  values (:'oa', 'reply', :'c02', 'running', '00000000-0000-0000-0000-0000000045a2', now() + interval '1 minute')
  returning id as job02 \gset
insert into public.automations (id, organization_id, name, trigger_type, trigger_config, status, activated_at, current_version)
  values (:'kw', :'oa', 'Orçamento 45', 'keyword_detected', '{"keywords":["orçamento"],"mode":"contains"}', 'active', now(), 1);
insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph)
  values (:'oa', :'kw', 1, 'keyword_detected', '{"keywords":["orçamento"],"mode":"contains"}',
    jsonb_build_object('nodes', jsonb_build_array(pg_temp.node('kt','trigger','{}')), 'edges', '[]'::jsonb));
select pg_temp.inbound('02', 'Quero um orcamento');
select ok((select automation_run_id is not null from public.conversations where id = :'c02'), 'palavra-chave vincula a conversa à execução');
select ok(not private.ai_reply_eligible((select c from public.conversations c where c.id = :'c02')),
  'conversa com execução ativa não é elegível para a IA');
select is(public.complete_ai_reply(:'job02', '00000000-0000-0000-0000-0000000045a2',
  '{"reply":{"text":"Olá!","usedChunkIds":[]},"lastMessageId":null}'::jsonb)->>'state', 'skipped',
  'resposta da IA gerada antes do vínculo é descartada');
select is((select state from public.ai_jobs where id = :'job02'), 'cancelled', 'tarefa da IA cancelada');
select is((select count(*)::int from public.messages where conversation_id = :'c02' and sender_type = 'ai'), 0, 'nenhuma mensagem da IA');
insert into public.ai_jobs (organization_id, kind, conversation_id, state, claim_token, claimed_until)
  values (:'oa', 'reply', :'c02', 'running', '00000000-0000-0000-0000-0000000045b2', now() + interval '1 minute')
  returning id as job02b \gset
select is(public.handoff_ai_job(:'job02b', '00000000-0000-0000-0000-0000000045b2', 'ai_failure')->>'state', 'skipped',
  'handoff da IA também é descartado durante a execução');
select is((select status::text from public.conversations where id = :'c02'), 'open', 'conversa não é transferida pela IA');
update public.automations set status = 'paused' where id = :'kw';

-- =============================================================== 3a. handoff_ai responde a última mensagem do cliente
select pg_temp.contact('03') as k03 \gset
select pg_temp.conv('03', 'human', 'pending_human') as c03 \gset
select pg_temp.run('03', :'nha') as r03 \gset
select pg_temp.inbound('03', 'Ainda está aí?', now() - interval '1 minute');
select is(pg_temp.ai_pending('03'), 0, 'mensagem durante a execução não enfileira a IA');
select pg_temp.hold(:'r03') as t03 \gset
select is(public.apply_automation_step(:'r03', :'t03', pg_temp.step(:'nha', '{"end":true}', '[{"type":"handoff_ai"}]'))->>'state',
  'completed', 'handoff_ai conclui a execução');
select is(pg_temp.ai_pending('03'), 1, 'handoff_ai enfileira resposta da IA para a mensagem sem resposta');
select ok((select run_after between now() + interval '3 seconds' and now() + interval '5 seconds' from public.ai_jobs
  where conversation_id = :'c03' and state = 'pending'), 'mesma janela de 4 s da Fase 6');

select pg_temp.contact('04') as k04 \gset
select pg_temp.conv('04') as c04 \gset
select pg_temp.run('04', :'nha') as r04 \gset
select pg_temp.inbound('04', 'Oi', now() - interval '2 minutes');
select pg_temp.outbound('04', now() - interval '1 minute');
select pg_temp.hold(:'r04') as t04 \gset
select public.apply_automation_step(:'r04', :'t04', pg_temp.step(:'nha', '{"end":true}', '[{"type":"handoff_ai"}]'));
select is(pg_temp.ai_pending('04'), 0, 'handoff_ai sem mensagem pendente do cliente não enfileira a IA');

-- =============================================================== 3b. retomada por texto que termina em silêncio
select pg_temp.contact('05') as k05 \gset
select pg_temp.conv('05') as c05 \gset
select pg_temp.waiting('05') as r05 \gset
select pg_temp.outbound('05', now() - interval '1 minute');
select pg_temp.inbound('05', 'Me conta mais');
select is((select input->>'text' from public.automation_runs where id = :'r05'), 'Me conta mais', 'texto digitado retoma a espera');
select is(pg_temp.ai_pending('05'), 0, 'resposta digitada não enfileira a IA durante a espera');
select pg_temp.hold(:'r05') as t05 \gset
select is(public.apply_automation_step(:'r05', :'t05', pg_temp.step(:'nm', jsonb_build_object('next', :'ne'), '[]', 'no_reply'))->>'state',
  'running', 'retomada segue para o fim');
select is(pg_temp.ai_pending('05'), 0, 'IA só entra quando a execução termina');
select is(public.apply_automation_step(:'r05', :'t05', pg_temp.step(:'ne', '{"end":true}'))->>'state', 'completed', 'execução concluída');
select is(pg_temp.ai_pending('05'), 1, 'execução retomada por texto que termina sem responder enfileira a IA');

-- retomada por texto que termina direto na espera (rota end)
select pg_temp.contact('06') as k06 \gset
select pg_temp.conv('06') as c06 \gset
select pg_temp.waiting('06') as r06 \gset
select pg_temp.inbound('06', 'Talvez');
select pg_temp.hold(:'r06') as t06 \gset
select public.apply_automation_step(:'r06', :'t06', pg_temp.step(:'nm', '{"end":true}', '[]', 'no_reply'));
select is(pg_temp.ai_pending('06'), 1, 'retomada por texto que conclui no próprio passo enfileira a IA');

-- tempo esgotado (sem resposta) não enfileira
select pg_temp.contact('07') as k07 \gset
select pg_temp.conv('07') as c07 \gset
select pg_temp.waiting('07') as r07 \gset
select pg_temp.inbound('07', 'Mensagem antiga', now() - interval '2 hours');
update public.automation_runs set input = null where id = :'r07';
select pg_temp.hold(:'r07') as t07 \gset
select public.apply_automation_step(:'r07', :'t07', pg_temp.step(:'nm', '{"end":true}', '[]', 'no_reply'));
select is(pg_temp.ai_pending('07'), 0, 'espera vencida sem resposta não enfileira a IA');

-- clique (optionId) não enfileira
select pg_temp.contact('08') as k08 \gset
select pg_temp.conv('08') as c08 \gset
select pg_temp.waiting('08') as r08 \gset
select pg_temp.inbound('08', 'Sim', now(), jsonb_build_object('origin', 'button', 'payload', private.automation_payload(:'r08', :'nm', 'a1')));
select is((select input->>'optionId' from public.automation_runs where id = :'r08'), 'a1', 'clique assinado retoma com a opção');
select pg_temp.hold(:'r08') as t08 \gset
select public.apply_automation_step(:'r08', :'t08', pg_temp.step(:'nm', '{"end":true}', '[]', 'opt:a1'));
select is(pg_temp.ai_pending('08'), 0, 'retomada por clique não enfileira a IA');

-- mensagem enviada depois da resposta: a automação respondeu, a IA não entra
select pg_temp.contact('09') as k09 \gset
select pg_temp.conv('09') as c09 \gset
select pg_temp.waiting('09') as r09 \gset
select pg_temp.inbound('09', 'sim');
select pg_temp.hold(:'r09') as t09 \gset
select public.apply_automation_step(:'r09', :'t09', pg_temp.step(:'nm', jsonb_build_object('next', :'np'), '[]', 'opt:a1'));
select public.apply_automation_step(:'r09', :'t09', pg_temp.step(:'np', jsonb_build_object('next', :'ne'),
  '[{"type":"send_text","text":"Obrigado"}]'));
select is(public.apply_automation_step(:'r09', :'t09', pg_temp.step(:'ne', '{"end":true}'))->>'state', 'completed', 'fluxo respondeu e terminou');
select is(pg_temp.ai_pending('09'), 0, 'execução que respondeu depois do texto não enfileira a IA');

-- =============================================================== 4. encerrar a conversa é terminal
select pg_temp.contact('10') as k10 \gset
select pg_temp.conv('10') as c10 \gset
select pg_temp.run('10', :'ncc') as r10 \gset
select pg_temp.hold(:'r10') as t10 \gset
select is(public.apply_automation_step(:'r10', :'t10', pg_temp.step(:'ncc', jsonb_build_object('next', :'ne'),
  '[{"type":"close_conversation"}]'))->>'state', 'completed', 'close_conversation conclui a execução (nada roda depois)');
select is((select status::text from public.automation_runs where id = :'r10'), 'completed', 'execução concluída, não cancelada');
select is((select status::text from public.conversations where id = :'c10'), 'closed', 'conversa fechada');

-- =============================================================== handoff_human grava o motivo 'automation'
select pg_temp.contact('11') as k11 \gset
select pg_temp.conv('11') as c11 \gset
select pg_temp.run('11', :'nhh') as r11 \gset
select pg_temp.hold(:'r11') as t11 \gset
select public.apply_automation_step(:'r11', :'t11', pg_temp.step(:'nhh', '{"end":true}', '[{"type":"handoff_human"}]'));
select is((select status::text || '/' || handled_by::text || '/' || handoff_reason from public.conversations where id = :'c11'),
  'pending_human/human/automation', 'handoff_human transfere com o motivo automation');
select is((select count(*)::int from public.messages where conversation_id = :'c11' and sender_type = 'system'
  and content = 'Automação transferiu para atendimento humano'), 1, 'mensagem de sistema da transferência');
select lives_ok($$update public.conversations set handoff_reason = 'needs_human' where id = md5('045c11')::uuid$$,
  'motivos da IA continuam válidos');
select throws_ok($$update public.conversations set handoff_reason = 'qualquer' where id = md5('045c11')::uuid$$, '23514',
  null, 'motivo desconhecido continua rejeitado');

-- =============================================================== 5. contains por palavra inteira (SQL)
select is(private.automation_keyword_matches('assim não', '{"keywords":["sim"],"mode":"contains"}'), false, '"sim" não casa com "assim"');
select is(private.automation_keyword_matches('Sim, quero!', '{"keywords":["sim"],"mode":"contains"}'), true, '"sim" casa com "Sim, quero!"');
select is(private.automation_keyword_matches('me segue no linkedin', '{"keywords":["link"],"mode":"contains"}'), false, '"link" não casa com "linkedin"');
select is(private.automation_keyword_matches('manda o LINK', '{"keywords":["link"],"mode":"contains"}'), true, '"link" casa como palavra');
select is(private.automation_keyword_matches('quero_link', '{"keywords":["link"],"mode":"contains"}'), false, 'sublinhado conta como letra');
select is(private.automation_keyword_matches('assim, sim', '{"keywords":["sim"],"mode":"contains"}'), true, 'segunda ocorrência inteira casa');
select is(private.automation_keyword_matches('Olá, QUERO   o Link já', '{"keywords":["quero o link"],"mode":"contains"}'), true, 'frase casa nos limites');
select is(private.automation_keyword_matches('quero o linkedin', '{"keywords":["quero o link"],"mode":"contains"}'), false, 'frase não casa no meio de palavra');
select is(private.automation_keyword_matches('Promoção!', '{"keywords":["promocao"],"mode":"equals"}'), false, 'equals inalterado');
select is(private.automation_keyword_matches('Cupom 10', '{"keywords":["cupom"],"mode":"starts_with"}'), true, 'starts_with inalterado');

-- =============================================================== 7. sem novas execuções em conversa com humano
update public.automations set status = 'active' where id = :'kw';
select pg_temp.contact('12') as k12 \gset
select pg_temp.conv('12', 'human', 'pending_human') as c12 \gset
select pg_temp.inbound('12', 'orçamento');
select is((select count(*)::int from public.automation_runs where conversation_id = :'c12'), 0, 'conversa aguardando humano não inicia execução');
select pg_temp.contact('13') as k13 \gset
select pg_temp.conv('13', 'human', 'open') as c13 \gset
select pg_temp.inbound('13', 'orçamento');
select is((select count(*)::int from public.automation_runs where conversation_id = :'c13'), 0, 'conversa assumida por humano (IA ativa) não inicia execução');
select pg_temp.contact('14') as k14 \gset
select pg_temp.conv('14') as c14 \gset
select pg_temp.inbound('14', 'orçamento');
select is((select count(*)::int from public.automation_runs where conversation_id = :'c14'), 1, 'conversa com a IA inicia execução');
-- sem IA ativa, handled_by='human' é só o padrão da conversa: automações continuam disparando
update public.ai_agents set is_active = false where organization_id = :'oa';
select pg_temp.inbound('13', 'orçamento de novo');
select is((select count(*)::int from public.automation_runs where conversation_id = :'c13'), 1, 'sem IA ativa, conversa padrão (human) inicia execução');
update public.ai_agents set is_active = true where organization_id = :'oa';
update public.automations set status = 'paused' where id = :'kw';
-- retomada continua valendo com humano
select pg_temp.contact('15') as k15 \gset
select pg_temp.conv('15', 'human', 'pending_human') as c15 \gset
select pg_temp.waiting('15') as r15 \gset
select pg_temp.inbound('15', 'Sim');
select is((select input->>'text' from public.automation_runs where id = :'r15'), 'Sim', 'execução em espera ainda retoma em conversa com humano');
-- eventos de CRM
insert into public.automations (id, organization_id, name, trigger_type, trigger_config, status, activated_at, current_version)
  values (:'crm', :'oa', 'Etiqueta 45', 'tag_added', '{"tagId":null}', 'active', now(), 1);
insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph)
  values (:'oa', :'crm', 1, 'tag_added', '{"tagId":null}',
    jsonb_build_object('nodes', jsonb_build_array(pg_temp.node('ct','trigger','{}')), 'edges', '[]'::jsonb));
insert into public.contact_tags (organization_id, contact_id, tag_id) values (:'oa', :'k12', '00000000-0000-0000-0000-000000004511');
select is((select count(*)::int from public.automation_runs where automation_id = :'crm'), 0, 'evento de CRM não inicia execução em conversa com humano');
select pg_temp.contact('16') as k16 \gset
select pg_temp.conv('16') as c16 \gset
insert into public.contact_tags (organization_id, contact_id, tag_id) values (:'oa', :'k16', '00000000-0000-0000-0000-000000004511');
select is((select count(*)::int from public.automation_runs where automation_id = :'crm' and conversation_id = :'c16'), 1, 'evento de CRM inicia execução em conversa com a IA');
update public.automations set status = 'paused' where id = :'crm';

-- =============================================================== Parar automação fecha o passo em espera
select pg_temp.contact('17') as k17 \gset
select pg_temp.conv('17') as c17 \gset
select pg_temp.waiting('17') as r17 \gset
select tests.authenticate_as(:'uag');
select public.stop_automation(:'c17');
select tests.clear_authentication();
select is((select status::text from public.automation_runs where id = :'r17'), 'cancelled', 'Parar automação cancela a execução');
select is((select status::text from public.automation_run_steps where run_id = :'r17'), 'cancelled', 'Parar automação fecha o passo em espera');

-- =============================================================== 6. cliques autênticos vencidos viram texto (Simulador / 7 argumentos)
select pg_temp.contact('18') as k18 \gset
select pg_temp.conv('18') as c18 \gset
select pg_temp.waiting('18') as r18 \gset
select pg_temp.contact('19') as k19 \gset
select pg_temp.conv('19') as c19 \gset
select pg_temp.waiting('19') as r19 \gset
-- assinatura válida, mesma organização e contato, mas outro nó: entra como texto sem payload e não retoma
select coalesce(pg_temp.inbound('18', 'Sim', now(), jsonb_build_object('origin', 'button', 'payload', private.automation_payload(:'r18', gen_random_uuid(), 'a1')))::text, '') as stale18 \gset
select ok(nullif(:'stale18','') is not null, 'clique vencido autêntico é registrado');
select is((select content || '/' || (context ? 'payload')::text from public.messages where id = nullif(:'stale18','')::uuid), 'Sim/false', 'clique vencido entra como texto, sem payload');
select is((select input from public.automation_runs where id = :'r18'), null::jsonb, 'clique vencido não retoma a espera atual');
-- opção que não existe mais
select coalesce(pg_temp.inbound('18', 'Talvez', now(), jsonb_build_object('origin', 'quick_reply', 'payload', private.automation_payload(:'r18', :'nm', 'zz')))::text, '') as stale18b \gset
select ok(nullif(:'stale18b','') is not null, 'opção removida também entra como texto');
select is((select input from public.automation_runs where id = :'r18'), null::jsonb, 'opção removida não retoma');
-- execução de outro contato: descartado
select is(pg_temp.inbound('18', 'Sim', now(), jsonb_build_object('origin', 'button', 'payload', private.automation_payload(:'r19', :'nm', 'a1'))),
  null::uuid, 'clique de execução de outro contato é descartado');
select is((select input from public.automation_runs where id = :'r19'), null::jsonb, 'execução do outro contato não retoma');
-- adulterado: descartado
select is(pg_temp.inbound('18', 'Sim', now(), '{"origin":"button","payload":"fa1.forjado"}'), null::uuid, 'payload adulterado é descartado');
select is((select count(*)::int from public.messages where conversation_id = :'c18' and direction = 'inbound'), 2, 'só os cliques autênticos viram mensagem');
-- execução que já terminou: o texto segue o caminho normal (a IA responde)
select tests.authenticate_as(:'uag');
select public.stop_automation(:'c18');
select tests.clear_authentication();
select coalesce(pg_temp.inbound('18', 'Sim', now(), jsonb_build_object('origin', 'button', 'payload', private.automation_payload(:'r18', :'nm', 'a1')))::text, '') as stale18c \gset
select ok(nullif(:'stale18c','') is not null, 'clique de execução encerrada vira texto');
select is(pg_temp.ai_pending('18'), 1, 'texto do clique vencido é atendido normalmente pela IA');
-- válido continua retomando
select pg_temp.inbound('19', 'Sim', now(), jsonb_build_object('origin', 'button', 'payload', private.automation_payload(:'r19', :'nm', 'a1')));
select is((select input->>'optionId' from public.automation_runs where id = :'r19'), 'a1', 'clique válido retoma com a opção');

-- clique do Simulador continua respondendo not_waiting quando a espera venceu
select pg_temp.contact('20') as k20 \gset
select pg_temp.conv('20') as c20 \gset
select pg_temp.waiting('20') as r20 \gset
insert into public.messages(organization_id, conversation_id, channel_id, direction, sender_type, content, status, context)
  values (:'oa', :'c20', :'sim', 'outbound', 'automation', 'Escolha', 'delivered', jsonb_build_object('automation',
    jsonb_build_object('runId', :'r20', 'nodeId', :'nm', 'buttons', '[]'::jsonb, 'quickReplies', '[{"id":"a1","title":"Sim"}]'::jsonb)))
  returning id as m20 \gset
update public.automation_runs set resume_at = now() - interval '1 second' where id = :'r20';
select tests.authenticate_as(:'uag');
select throws_ok(format('select public.click_automation_button(%L, %L)', :'m20', 'a1'), '22023', 'not_waiting',
  'clique simulado numa espera vencida continua not_waiting');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where conversation_id = :'c20' and direction = 'inbound'), 0, 'clique recusado não grava mensagem');

-- =============================================================== Instagram: cliques vencidos, regra migrada e pausa
select public.save_instagram_connection(:'ua',:'oa','{"appId":"145","appSecret":"app","accessToken":"access","accountId":"78945","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn, (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
insert into public.contacts(id, organization_id, name, instagram_id) values (pg_temp.n('k21'), :'oa', 'Cliente IG', '94521');
insert into public.conversations(id, organization_id, contact_id, channel_id, handled_by)
  values (pg_temp.n('c21'), :'oa', pg_temp.n('k21'), :'chan', 'ai');
select pg_temp.waiting('21') as r21 \gset
select public.ingest_instagram_event(:'conn', jsonb_build_object('kind','button','accountId','78945','externalId','stale45',
  'senderExternalId','94521','title','Sim','payload',private.automation_payload(:'r21', gen_random_uuid(), 'a1'),'occurredAt',now())) as ige \gset
select is(:'ige'::jsonb->>'state', 'done', 'Instagram: clique vencido autêntico é processado');
select is((select content || '/' || (context ? 'payload')::text || '/' || (context->>'origin') from public.messages where external_id = 'stale45'),
  'Sim/false/button', 'Instagram: clique vencido entra como texto sem payload');
select is((select input from public.automation_runs where id = :'r21'), null::jsonb, 'Instagram: clique vencido não retoma');
select is((select count(*)::int from public.events where type = 'button_clicked' and conversation_id = pg_temp.n('c21')), 0, 'clique vencido não emite button_clicked');
select is(public.ingest_instagram_event(:'conn', jsonb_build_object('kind','button','accountId','78945','externalId','forged45',
  'senderExternalId','94521','title','Sim','payload','fa1.forjado','occurredAt',now()))->>'state', 'ignored', 'Instagram: clique adulterado descartado');
select is(public.ingest_instagram_event(:'conn', jsonb_build_object('kind','button','accountId','78945','externalId','other45',
  'senderExternalId','94599','title','Sim','payload',private.automation_payload(:'r21', :'nm', 'a1'),'occurredAt',now()))->>'state',
  'ignored', 'Instagram: clique de outro remetente descartado');
select public.ingest_instagram_event(:'conn', jsonb_build_object('kind','button','accountId','78945','externalId','valid45',
  'senderExternalId','94521','title','Sim','payload',private.automation_payload(:'r21', :'nm', 'a1'),'occurredAt',now()));
select is((select input->>'optionId' from public.automation_runs where id = :'r21'), 'a1', 'Instagram: clique válido retoma');

-- regra de comentário migrada: contains por palavra inteira
insert into public.instagram_comment_rules(organization_id,channel_id,keyword,reply_text,active)
  values (:'oa', :'chan', 'sim', 'Oi! Segue o link', true) returning id as rule \gset
select private.migrate_instagram_comment_rules();
select is(public.ingest_instagram_event(:'conn', jsonb_build_object('kind','comment','accountId','78945','externalId','assim45',
  'commentId','assim45','mediaId','80045','senderExternalId','94522','text','Assim fica difícil','occurredAt',now()))->>'state',
  'ignored', 'regra migrada: "sim" não casa com "Assim"');
select public.ingest_instagram_event(:'conn', jsonb_build_object('kind','comment','accountId','78945','externalId','sim45',
  'commentId','sim45','mediaId','80045','senderExternalId','94522','text','SIM, quero!','occurredAt',now())) as cev \gset
select is(:'cev'::jsonb->>'state', 'pending', 'regra migrada: "SIM, quero!" casa');
select (:'cev'::jsonb->>'eventId') as cevid \gset

-- automação pausada não envia resposta privada ainda na fila
select public.prepare_instagram_comment_send(:'cevid') as prepared \gset
select (:'prepared'::jsonb->>'intentId') as intent \gset
select tests.authenticate_as(:'ua');
select public.pause_automation(:'rule');
select tests.clear_authentication();
select is(public.claim_instagram_send(:'intent'), 'null'::jsonb, 'automação pausada: resposta privada na fila não é reservada');
select is((select state from public.instagram_send_intents where id = :'intent'), 'pending', 'nada foi enviado');
select is((select count(*)::int from public.automation_runs where automation_id = :'rule'), 0, 'nenhuma execução criada');
select is(public.prepare_instagram_comment_send(:'cevid'), 'null'::jsonb, 'automação pausada: comentário não é preparado');

select * from finish();
rollback;
