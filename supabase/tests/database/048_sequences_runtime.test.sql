begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Fase 7B, Task 5: sequências em execução (20261014000003_sequences_runtime.sql).
select tests.create_user('owner48@t.test','Dona48') as ua \gset
select tests.create_user('agent48@t.test','Agente48') as uag \gset
select tests.create_user('viewer48@t.test','Viewer48') as uv \gset
select tests.create_user('owner48b@t.test','Dona48B') as ub \gset
select tests.create_org(:'ua','Org48') as oa \gset
select tests.create_org(:'ub','Org48B') as ob \gset
select tests.add_member(:'oa',:'uag','agent');
select tests.add_member(:'oa',:'uv','viewer');

\set sim1 '00000000-0000-0000-0000-000000004801'
\set sim2 '00000000-0000-0000-0000-000000004802'
\set simb '00000000-0000-0000-0000-000000004803'
\set s1 '00000000-0000-0000-0000-000000004811'
\set s2 '00000000-0000-0000-0000-000000004812'
\set s3 '00000000-0000-0000-0000-000000004813'
\set s4 '00000000-0000-0000-0000-000000004814'
\set s5 '00000000-0000-0000-0000-000000004815'
\set s6 '00000000-0000-0000-0000-000000004816'
\set sb '00000000-0000-0000-0000-000000004817'
insert into public.channels(id,organization_id,type,name,status) values
  (:'sim1',:'oa','simulator','Sim48','active'),
  (:'sim2',:'oa','whatsapp','Zap48','active'),
  (:'simb',:'ob','simulator','Sim48B','active');
insert into public.sequences(id,organization_id,name,status,settings) values
  (:'s1',:'oa','Boas-vindas','active',jsonb_build_object('channelIds',jsonb_build_array(:'sim1'))),
  (:'s2',:'oa','Reengajar','active',jsonb_build_object('channelIds',jsonb_build_array(:'sim1'),'exitOnReply',true)),
  (:'s3',:'oa','Rascunho','draft',jsonb_build_object('channelIds',jsonb_build_array(:'sim1'))),
  (:'s4',:'oa','Janela','active',jsonb_build_object('channelIds',jsonb_build_array(:'sim1'))),
  (:'s5',:'oa','Pausável','active',jsonb_build_object('channelIds',jsonb_build_array(:'sim1'))),
  (:'s6',:'oa','Editável','active',jsonb_build_object('channelIds',jsonb_build_array(:'sim1'))),
  (:'sb',:'ob','Outra','active',jsonb_build_object('channelIds',jsonb_build_array(:'simb')));
insert into public.sequence_steps(id,organization_id,sequence_id,position,delay_minutes,"window",message) values
  ('00000000-0000-0000-0000-000000004821',:'oa',:'s1',1,60,null,'{"text":"Oi"}'),
  ('00000000-0000-0000-0000-000000004822',:'oa',:'s1',2,1440,'{"days":[1,2,3,4,5],"start":"09:00","end":"18:00"}','{"text":"Dia 2"}'),
  ('00000000-0000-0000-0000-000000004823',:'oa',:'s1',3,10,null,'{"text":"Fim"}'),
  ('00000000-0000-0000-0000-000000004824',:'oa',:'s2',1,30,null,'{"text":"Volta"}'),
  ('00000000-0000-0000-0000-000000004825',:'oa',:'s3',1,30,null,'{"text":"Rascunho"}'),
  ('00000000-0000-0000-0000-000000004826',:'oa',:'s4',1,1,'{"days":[1,2,3,4,5,6,7],"start":"03:00","end":"03:01"}','{"text":"Cedo"}'),
  ('00000000-0000-0000-0000-000000004827',:'oa',:'s5',1,60,null,'{"text":"P1"}'),
  ('00000000-0000-0000-0000-000000004828',:'oa',:'s5',2,60,null,'{"text":"P2"}'),
  ('00000000-0000-0000-0000-000000004829',:'oa',:'s6',1,5,null,'{"text":"E1"}'),
  ('00000000-0000-0000-0000-000000004830',:'oa',:'s6',2,5,null,'{"text":"E2"}'),
  ('00000000-0000-0000-0000-000000004831',:'oa',:'s6',3,5,null,'{"text":"E3"}'),
  ('00000000-0000-0000-0000-000000004832',:'ob',:'sb',1,5,null,'{"text":"B"}');

create function pg_temp.n(p_k text) returns uuid language sql as $$ select md5('048' || p_k)::uuid $$;
create function pg_temp.contact(p_k text, p_org uuid default null) returns uuid language sql as $$
  insert into public.contacts(id, organization_id, name, phone)
    values (pg_temp.n('k' || p_k), coalesce(p_org, (select id from public.organizations where name = 'Org48')),
      'Contato ' || p_k, '+55410480' || p_k)
    returning id $$;
create function pg_temp.conv(p_k text) returns uuid language sql as $$
  insert into public.conversations(id, organization_id, contact_id, channel_id, handled_by, status)
    values (pg_temp.n('c' || p_k), (select id from public.organizations where name = 'Org48'), pg_temp.n('k' || p_k),
      '00000000-0000-0000-0000-000000004801', 'human', 'open')
    returning id $$;
create function pg_temp.inbound(p_k text, p_text text, p_channel uuid default '00000000-0000-0000-0000-000000004801')
  returns uuid language sql as $$
  select public.ingest_inbound_message(p_channel, 'in' || p_k || md5(random()::text), '+55410480' || p_k, null, p_text,
    now(), '{}') $$;
create function pg_temp.enr(p_seq uuid, p_k text) returns public.sequence_enrollments language sql as $$
  select * from public.sequence_enrollments where sequence_id = p_seq and contact_id = pg_temp.n('k' || p_k)
    order by created_at desc, id desc limit 1 $$;
create function pg_temp.dels(p_seq uuid, p_k text) returns setof public.outreach_deliveries language sql as $$
  select d.* from public.outreach_deliveries d join public.sequence_enrollments e on e.id = d.enrollment_id
    where e.sequence_id = p_seq and e.contact_id = pg_temp.n('k' || p_k) order by d.created_at, d.id $$;
create function pg_temp.pending(p_seq uuid, p_k text) returns public.outreach_deliveries language sql as $$
  select * from pg_temp.dels(p_seq, p_k) where status = 'pending' $$;
create function pg_temp.sent(p_seq uuid, p_k text) returns void language sql as $$
  update public.outreach_deliveries set status = 'sent' where id = (pg_temp.pending(p_seq, p_k)).id $$;
create function pg_temp.notes(p_k text) returns int language sql as $$
  select count(*)::int from public.messages where conversation_id = pg_temp.n('c' || p_k) and sender_type = 'system'
    and direction = 'outbound' and content like 'Saiu da sequência %' $$;
select pg_temp.contact(k) from unnest(array['01','02','03','04','05','06','07','08','09','10','11']) k;
select pg_temp.conv(k) from unnest(array['01','03','04','05','06','07','08','09','11']) k;

-- =============================================================== next_send_time (espelha o core)
\set wd '{"days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'
\set all7 '{"days":[1,2,3,4,5,6,7],"start":"09:00","end":"18:00"}'
select is(private.next_send_time('2026-10-16T21:00:00Z', 1, :'wd', 'America/Sao_Paulo'), '2026-10-19T12:00:00Z'::timestamptz,
  'sexta 18:00 SP → segunda 09:00 SP');
select is(private.next_send_time('2026-10-16T21:00:00Z', 90, null, 'America/Sao_Paulo'), '2026-10-16T22:30:00Z'::timestamptz,
  'sem janela = from + delay');
select is(private.next_send_time('2026-10-14T13:00:00Z', 30, :'wd', 'America/Sao_Paulo'), '2026-10-14T13:30:00Z'::timestamptz,
  'dentro da janela não muda');
select is(private.next_send_time('2026-10-14T10:00:00Z', 10, :'wd', 'America/Sao_Paulo'), '2026-10-14T12:00:00Z'::timestamptz,
  'antes do início vai para o início do mesmo dia');
select is(private.next_send_time('2026-10-14T20:59:00Z', 1, :'wd', 'America/Sao_Paulo'), '2026-10-15T12:00:00Z'::timestamptz,
  'fim exclusivo');
select is(private.next_send_time('2026-10-31T23:00:00Z', 1, :'all7', 'America/New_York'), '2026-11-01T14:00:00Z'::timestamptz,
  'Nova York: 09:00 local depois do fim do horário de verão');
select is(private.next_send_time('2026-10-30T23:00:00Z', 1, :'all7', 'America/New_York'), '2026-10-31T13:00:00Z'::timestamptz,
  'Nova York: 09:00 local antes do fim do horário de verão');

-- =============================================================== is_exit_word (espelha o core)
\set words '["sair","parar","cancelar"]'
select ok(private.is_exit_word('Parar!', :'words'), '"Parar!" é palavra de saída');
select ok(private.is_exit_word('  SAIR ', :'words'), '"  SAIR " é palavra de saída');
select ok(not private.is_exit_word('não quero parar agora', :'words'), 'palavra dentro de frase não sai');
select ok(not private.is_exit_word('...', :'words'), 'só pontuação não sai');
select ok(private.is_exit_word('Cancélar.', :'words'), 'acento e pontuação nas pontas são ignorados');
select ok(private.is_exit_word('tchau!!', '["Tchau"]'), 'palavras de saída da sequência');
select ok(not private.is_exit_word('sair', '[]'), 'lista vazia: nenhuma palavra sai');

-- =============================================================== segurança
select ok(not has_function_privilege('authenticated','private.sequence_enroll(uuid,uuid,text)','execute'),'authenticated não executa sequence_enroll');
select ok(not has_function_privilege('authenticated','private.sequence_remove(uuid,uuid,text)','execute'),'authenticated não executa sequence_remove');
select ok(not has_function_privilege('authenticated','private.sequence_schedule_next(uuid)','execute'),'authenticated não executa sequence_schedule_next');
select ok(not has_function_privilege('anon','public.enroll_contact_in_sequence(uuid,uuid)','execute'),'anon não inscreve');
select ok(not has_function_privilege('anon','public.remove_contact_from_sequence(uuid,uuid)','execute'),'anon não remove');
select ok(has_function_privilege('authenticated','public.enroll_contact_in_sequence(uuid,uuid)','execute'),'authenticated inscreve');
select ok(has_function_privilege('authenticated','public.remove_contact_from_sequence(uuid,uuid)','execute'),'authenticated remove');

-- =============================================================== inscrição pela ficha
select tests.authenticate_as(:'uv');
select throws_ok(format('select public.enroll_contact_in_sequence(%L, %L)', :'s1', pg_temp.n('k01')), '42501', null, 'viewer não inscreve');
select tests.authenticate_as(:'ub');
select throws_ok(format('select public.enroll_contact_in_sequence(%L, %L)', :'s1', pg_temp.n('k01')), 'P0002', null, 'outra organização: P0002');
select throws_ok(format('select public.enroll_contact_in_sequence(%L, %L)', :'sb', pg_temp.n('k01')), 'P0002', null, 'contato de outra organização: P0002');
select tests.authenticate_as(:'uag');
select throws_ok(format('select public.enroll_contact_in_sequence(%L, %L)', :'s3', pg_temp.n('k01')), '22023', null, 'sequência em rascunho recusa inscrição');
select isnt(public.enroll_contact_in_sequence(:'s1', pg_temp.n('k01')), null, 'agent inscreve pela ficha');
select tests.clear_authentication();
select is((pg_temp.enr(:'s1','01')).status, 'active', 'inscrição ativa');
select is((pg_temp.enr(:'s1','01')).channel_id, :'sim1'::uuid, 'canal da sequência com conversa');
select is((pg_temp.enr(:'s1','01')).current_position, 1, 'posição 1');
select is((select count(*)::int from pg_temp.dels(:'s1','01')), 1, 'uma entrega criada');
select is((pg_temp.pending(:'s1','01')).step_id, '00000000-0000-0000-0000-000000004821'::uuid, 'entrega do primeiro passo');
select is((pg_temp.pending(:'s1','01')).conversation_id, pg_temp.n('c01'), 'entrega na conversa do contato');
select is((pg_temp.pending(:'s1','01')).run_after, now() + interval '60 minutes', 'run_after = agora + espera');
select is((pg_temp.pending(:'s1','01')).source, 'sequence', 'origem sequence');
select is((pg_temp.enr(:'s1','01')).next_send_at, now() + interval '60 minutes', 'próximo envio previsto');

-- duplicidade
select tests.authenticate_as(:'uag');
select is(public.enroll_contact_in_sequence(:'s1', pg_temp.n('k01')), null, 'inscrição duplicada é ignorada');
select tests.clear_authentication();
select is((select count(*)::int from public.sequence_enrollments where sequence_id = :'s1' and contact_id = pg_temp.n('k01')), 1,
  'uma única inscrição');
select is((select count(*)::int from pg_temp.dels(:'s1','01')), 1, 'nenhuma entrega nova');
select is((select count(*)::int from public.events where type = 'sequence_enroll_ignored' and contact_id = pg_temp.n('k01')
  and actor_type = 'user' and actor_id = :'uag' and payload ->> 'sequence_id' = :'s1'), 1, 'duplicidade registrada como evento');

-- contato sem conversa no canal: inscrição criada; o primeiro passo dará no_conversation no envio
select tests.authenticate_as(:'ua');
select isnt(public.enroll_contact_in_sequence(:'s1', pg_temp.n('k02')), null, 'contato sem conversa é inscrito');
select tests.clear_authentication();
select is((pg_temp.enr(:'s1','02')).channel_id, :'sim1'::uuid, 'canal = primeiro canal da sequência');
select is((pg_temp.pending(:'s1','02')).conversation_id, null, 'entrega sem conversa');

-- =============================================================== run_after respeita a janela
select isnt(private.sequence_enroll(:'s4', pg_temp.n('k03'), 'system'), null, 'inscrição direta');
select is((pg_temp.pending(:'s4','03')).run_after,
  private.next_send_time(now(), 1, '{"days":[1,2,3,4,5,6,7],"start":"03:00","end":"03:01"}', 'America/Sao_Paulo'),
  'run_after calculado com a janela e o fuso da organização');
select is(to_char((pg_temp.pending(:'s4','03')).run_after at time zone 'America/Sao_Paulo', 'HH24:MI'), '03:00',
  'run_after no início da janela');

-- =============================================================== inscrição e remoção pelo bloco
insert into public.automations (id, organization_id, name, trigger_type, trigger_config, status, activated_at, current_version)
  values (pg_temp.n('auto'), :'oa', 'Fluxo 48', 'contact_created', '{}', 'paused', now(), 1);
insert into public.automation_versions (organization_id, automation_id, version, trigger_type, trigger_config, graph)
  values (:'oa', pg_temp.n('auto'), 1, 'contact_created', '{}', jsonb_build_object(
    'nodes', jsonb_build_array(
      jsonb_build_object('id', pg_temp.n('nt'), 'type', 'trigger', 'config', '{}'::jsonb, 'position', '{"x":0,"y":0}'::jsonb),
      jsonb_build_object('id', pg_temp.n('nen'), 'type', 'sequence_enroll', 'config', jsonb_build_object('sequenceId', :'s1'), 'position', '{"x":0,"y":0}'::jsonb),
      jsonb_build_object('id', pg_temp.n('nrm'), 'type', 'sequence_remove', 'config', jsonb_build_object('sequenceId', :'s1'), 'position', '{"x":0,"y":0}'::jsonb)),
    'edges', '[]'::jsonb));
create function pg_temp.run(p_k text, p_node text) returns uuid language plpgsql as $$
declare v_event uuid; v_org uuid := (select id from public.organizations where name = 'Org48');
begin
  insert into public.events (organization_id, type, contact_id, actor_type, payload)
    values (v_org, 'automation_trigger', pg_temp.n('k03'), 'system', '{}') returning id into v_event;
  insert into public.automation_runs (id, organization_id, automation_id, trigger_event_id, contact_id, status,
      current_node_id, resume_at, version, attempts, claim_token, claimed_until)
    values (pg_temp.n('r' || p_k), v_org, pg_temp.n('auto'), v_event, pg_temp.n('k03'), 'running', pg_temp.n(p_node),
      now(), 1, 1, pg_temp.n('tok' || p_k), now() + interval '3 minutes');
  return pg_temp.n('r' || p_k);
end $$;
create function pg_temp.apply(p_k text, p_node text, p_type text, p_seq uuid) returns jsonb language sql as $$
  select public.apply_automation_step(pg_temp.n('r' || p_k), pg_temp.n('tok' || p_k), jsonb_build_object(
    'nodeId', pg_temp.n(p_node), 'iteration', 0, 'handle', 'default',
    'effects', jsonb_build_array(jsonb_build_object('type', p_type, 'sequenceId', p_seq)), 'route', '{"end":true}'::jsonb)) $$;
select pg_temp.run('a', 'nen'), pg_temp.run('b', 'nen'), pg_temp.run('c', 'nen'), pg_temp.run('d', 'nrm'),
  pg_temp.run('e', 'nen');
select is(pg_temp.apply('a', 'nen', 'sequence_enroll', :'s1') ->> 'state', 'completed', 'bloco de inscrição aplicado');
select is((pg_temp.enr(:'s1','03')).status, 'active', 'bloco inscreve o contato');
select is((select count(*)::int from pg_temp.dels(:'s1','03') where status = 'pending'), 1, 'bloco agenda o primeiro passo');
select is(pg_temp.apply('b', 'nen', 'sequence_enroll', :'s1') ->> 'state', 'completed', 'bloco repetido aplicado');
select is((select count(*)::int from public.events where type = 'sequence_enroll_ignored' and contact_id = pg_temp.n('k03')
  and actor_type = 'automation'), 1, 'duplicidade pelo bloco registrada');
select is(pg_temp.apply('c', 'nen', 'sequence_enroll', :'s3') ->> 'state', 'completed', 'bloco com sequência em rascunho não falha');
select is((pg_temp.enr(:'s3','03')).id, null, 'rascunho: nenhuma inscrição pelo bloco');
select is(pg_temp.apply('d', 'nrm', 'sequence_remove', :'s1') ->> 'state', 'completed', 'bloco de remoção aplicado');
select is((pg_temp.enr(:'s1','03')).status, 'removed', 'bloco remove o contato');
select is((pg_temp.enr(:'s1','03')).exit_reason, 'removed', 'motivo removed');
select is((select reason from pg_temp.dels(:'s1','03')), 'removed', 'entrega pendente cancelada (removed)');
select is((select status from pg_temp.dels(:'s1','03')), 'cancelled', 'entrega cancelada');
select throws_ok(format($$select public.apply_automation_step(%L, %L, jsonb_build_object('nodeId', %L, 'iteration', 0,
    'handle', 'default', 'effects', '[{"type":"sequence_enroll","sequenceId":"x"}]'::jsonb, 'route', '{"end":true}'::jsonb))$$,
  pg_temp.n('re'), pg_temp.n('toke'), pg_temp.n('nen')), '22023', null, 'efeito com sequenceId inválido é recusado');
select is(pg_temp.apply('e', 'nen', 'sequence_enroll', :'s1') ->> 'state', 'completed', 'reinscrição depois de removido');
select is((select count(*)::int from public.sequence_enrollments where sequence_id = :'s1' and contact_id = pg_temp.n('k03')), 2,
  'nova inscrição depois da remoção');

-- =============================================================== RF3: palavra de saída
select tests.authenticate_as(:'uag');
select isnt(public.enroll_contact_in_sequence(:'s1', pg_temp.n('k04')), null, 'contato 04 inscrito');
select tests.clear_authentication();
select pg_temp.inbound('04', 'não quero parar agora');
select is((pg_temp.enr(:'s1','04')).status, 'active', 'RF3: "não quero parar agora" mantém a inscrição');
select is((select count(*)::int from pg_temp.dels(:'s1','04') where status = 'pending'), 1, 'RF3: entrega segue pendente');
select is(pg_temp.notes('04'), 0, 'RF3: nenhuma nota');
select pg_temp.inbound('04', 'Parar!');
select is((pg_temp.enr(:'s1','04')).status, 'exited', 'RF3: "Parar!" sai da sequência');
select is((pg_temp.enr(:'s1','04')).exit_reason, 'exit_word', 'RF3: motivo exit_word');
select is((select status || ':' || reason from pg_temp.dels(:'s1','04')), 'cancelled:exit_word', 'RF3: entrega cancelada');
select is(pg_temp.notes('04'), 1, 'RF3: nota registrada');
select is((select content from public.messages where conversation_id = pg_temp.n('c04') and sender_type = 'system'
  and content like 'Saiu da sequência %'), 'Saiu da sequência Boas-vindas', 'RF3: texto da nota');
select ok((select m.created_at > i.created_at from public.messages m, public.messages i
  where m.conversation_id = pg_temp.n('c04') and m.content like 'Saiu da sequência %'
    and i.conversation_id = pg_temp.n('c04') and i.content = 'Parar!'), 'nota depois da mensagem');

-- =============================================================== exitOnReply
select private.sequence_enroll(:'s1', pg_temp.n('k05'), 'system');
select private.sequence_enroll(:'s2', pg_temp.n('k05'), 'system');
select pg_temp.inbound('05', 'oi, tudo bem?');
select is((pg_temp.enr(:'s2','05')).status, 'exited', 'exitOnReply: qualquer resposta sai');
select is((pg_temp.enr(:'s2','05')).exit_reason, 'replied', 'exitOnReply: motivo replied');
select is((select status || ':' || reason from pg_temp.dels(:'s2','05')), 'cancelled:replied', 'exitOnReply: entrega cancelada');
select is((pg_temp.enr(:'s1','05')).status, 'active', 'sequência sem exitOnReply mantém a inscrição');
select is(pg_temp.notes('05'), 0, 'resposta não registra nota');

-- canal diferente da inscrição: não sai
select private.sequence_enroll(:'s1', pg_temp.n('k06'), 'system');
select pg_temp.inbound('06', 'sair', :'sim2');
select is((pg_temp.enr(:'s1','06')).status, 'active', 'palavra de saída em outro canal não remove');
select pg_temp.inbound('06', 'SAIR');
select is((pg_temp.enr(:'s1','06')).status, 'exited', 'palavra de saída no canal da inscrição remove');

-- =============================================================== agendamento do próximo passo
select private.sequence_enroll(:'s1', pg_temp.n('k07'), 'system');
select pg_temp.sent(:'s1','07');
select private.sequence_schedule_next((pg_temp.enr(:'s1','07')).id);
select is((pg_temp.enr(:'s1','07')).current_position, 2, 'avança para a posição 2');
select is((pg_temp.pending(:'s1','07')).step_id, '00000000-0000-0000-0000-000000004822'::uuid, 'entrega do segundo passo');
select is((pg_temp.pending(:'s1','07')).run_after,
  private.next_send_time(now(), 1440, '{"days":[1,2,3,4,5],"start":"09:00","end":"18:00"}', 'America/Sao_Paulo'),
  'próximo passo a partir de agora, com janela');
select is((pg_temp.enr(:'s1','07')).next_send_at, (pg_temp.pending(:'s1','07')).run_after, 'next_send_at acompanha a entrega');
select private.sequence_schedule_next((pg_temp.enr(:'s1','07')).id);
select is((select count(*)::int from pg_temp.dels(:'s1','07')), 2, 'idempotente com entrega pendente');
select pg_temp.sent(:'s1','07');
select private.sequence_schedule_next((pg_temp.enr(:'s1','07')).id);
select is((pg_temp.pending(:'s1','07')).step_id, '00000000-0000-0000-0000-000000004823'::uuid, 'terceiro passo');
select is((pg_temp.pending(:'s1','07')).run_after, now() + interval '10 minutes', 'terceiro passo sem janela');
select pg_temp.sent(:'s1','07');
select private.sequence_schedule_next((pg_temp.enr(:'s1','07')).id);
select is((pg_temp.enr(:'s1','07')).status, 'completed', 'último passo enviado: completed');
select is((pg_temp.enr(:'s1','07')).next_send_at, null, 'completed sem próximo envio');
select is((select count(*)::int from pg_temp.dels(:'s1','07')), 3, 'três entregas no total');

-- passo removido: os inscritos seguem para o seguinte
select private.sequence_enroll(:'s6', pg_temp.n('k08'), 'system');
select pg_temp.sent(:'s6','08');
select private.sequence_schedule_next((pg_temp.enr(:'s6','08')).id);
select is((pg_temp.pending(:'s6','08')).step_id, '00000000-0000-0000-0000-000000004830'::uuid, 'E2 pendente');
select tests.authenticate_as(:'ua');
select public.save_sequence(:'oa', :'s6', 'Editável', jsonb_build_object('channelIds', jsonb_build_array(:'sim1')),
  '[{"id":"00000000-0000-0000-0000-000000004829","delayMinutes":5,"window":null,"message":{"text":"E1"}},
    {"id":"00000000-0000-0000-0000-000000004831","delayMinutes":5,"window":null,"message":{"text":"E3"}}]');
select tests.clear_authentication();
select is((select status || ':' || reason from pg_temp.dels(:'s6','08') where step_id = '00000000-0000-0000-0000-000000004830'),
  'cancelled:step_removed', 'entrega do passo removido cancelada');
select is((pg_temp.pending(:'s6','08')).step_id, '00000000-0000-0000-0000-000000004831'::uuid, 'segue para o passo seguinte (E3)');
select is((pg_temp.enr(:'s6','08')).current_position, 2, 'posição do passo seguinte');
select is((pg_temp.pending(:'s6','08')).run_after, now() + interval '5 minutes', 'passo seguinte a partir de agora');

-- =============================================================== pausar e retomar
select tests.authenticate_as(:'uag');
select isnt(public.enroll_contact_in_sequence(:'s5', pg_temp.n('k09')), null, 'contato 09 inscrito na pausável');
select tests.authenticate_as(:'ua');
select public.set_sequence_status(:'s5', 'paused');
select tests.clear_authentication();
select is((select status || ':' || reason from pg_temp.dels(:'s5','09')), 'cancelled:paused', 'pausar cancela as entregas pendentes');
select is((pg_temp.enr(:'s5','09')).status, 'active', 'pausar mantém a inscrição');
select is((pg_temp.enr(:'s5','09')).next_send_at, null, 'pausada: sem próximo envio');
select tests.authenticate_as(:'uag');
select throws_ok(format('select public.enroll_contact_in_sequence(%L, %L)', :'s5', pg_temp.n('k10')), '22023', null,
  'sequência pausada recusa inscrição');
select tests.authenticate_as(:'ua');
select public.set_sequence_status(:'s5', 'active');
select tests.clear_authentication();
select is((select count(*)::int from pg_temp.dels(:'s5','09')), 1, 'retomar reaproveita a entrega do passo atual');
select is((pg_temp.pending(:'s5','09')).step_id, '00000000-0000-0000-0000-000000004827'::uuid, 'passo atual pendente de novo');
select is((pg_temp.pending(:'s5','09')).reason, null, 'sem motivo');
select is((pg_temp.pending(:'s5','09')).run_after, now() + interval '60 minutes', 'recalculado a partir de agora');
select is((pg_temp.enr(:'s5','09')).next_send_at, now() + interval '60 minutes', 'próximo envio recalculado');

-- =============================================================== contato excluído
select private.sequence_enroll(:'s1', pg_temp.n('k11'), 'system');
select private.sequence_enroll(:'s5', pg_temp.n('k11'), 'system');
select array_agg(d.id) as k11dels from public.outreach_deliveries d
  join public.sequence_enrollments e on e.id = d.enrollment_id where e.contact_id = pg_temp.n('k11') \gset
delete from public.contacts where id = pg_temp.n('k11');
select is((select count(*)::int from public.sequence_enrollments where contact_id = pg_temp.n('k11')), 0,
  'contato excluído sai de todas as sequências');
select is((select array_agg(distinct status || ':' || reason) from public.outreach_deliveries where id = any (:'k11dels'::uuid[])),
  array['cancelled:contact_deleted'], 'entregas do contato excluído canceladas');

-- =============================================================== remoção pela ficha
select tests.authenticate_as(:'uv');
select throws_ok(format('select public.remove_contact_from_sequence(%L, %L)', :'s1', pg_temp.n('k01')), '42501', null, 'viewer não remove');
select tests.authenticate_as(:'ub');
select throws_ok(format('select public.remove_contact_from_sequence(%L, %L)', :'s1', pg_temp.n('k01')), 'P0002', null, 'outra organização não remove');
select tests.authenticate_as(:'uag');
select lives_ok(format('select public.remove_contact_from_sequence(%L, %L)', :'s1', pg_temp.n('k01')), 'agent remove pela ficha');
select lives_ok(format('select public.remove_contact_from_sequence(%L, %L)', :'s1', pg_temp.n('k01')), 'remover de novo é inofensivo');
select tests.clear_authentication();
select is((pg_temp.enr(:'s1','01')).status, 'removed', 'removido pela ficha');
select is((select status || ':' || reason from pg_temp.dels(:'s1','01')), 'cancelled:removed', 'entrega cancelada (removed)');

select * from finish();
rollback;
