begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

select tests.create_user('ua@t.test') as ua \gset
select tests.create_user('uagent@t.test') as uagent \gset
select tests.create_user('ub@t.test') as ub \gset
select tests.create_org(:'ua', 'Org A') as org \gset
select tests.create_org(:'ub', 'Org B') as orgb \gset
select tests.add_member(:'org', :'uagent', 'agent');

insert into public.pipelines (organization_id, name, is_default) values (:'org', 'P', true) returning id as pipe \gset
insert into public.pipeline_stages (organization_id, pipeline_id, name, position, is_won, is_lost) values
  (:'org', :'pipe', 'Novo', 0, false, false),
  (:'org', :'pipe', 'Interessado', 1, false, false),
  (:'org', :'pipe', 'Ganho', 2, true, false),
  (:'org', :'pipe', 'Perdido', 3, false, true);
select id as s_novo from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Novo' \gset
select id as s_int from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Interessado' \gset
select id as s_ganho from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Ganho' \gset
select id as s_perdido from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Perdido' \gset
insert into public.channels (organization_id, type, name) values (:'org', 'whatsapp', 'ch') returning id as ch \gset

-- 1. contact_created
insert into public.contacts (organization_id, name, source) values (:'org', 'C1', 'instagram') returning id as c1 \gset
select is((select count(*)::int from public.events where organization_id = :'org' and type = 'contact_created'), 1, 'insert contact gera 1 contact_created');
select is((select payload->>'source' from public.events where type = 'contact_created' and contact_id = :'c1'), 'instagram', 'contact_created traz source');
select is((select contact_id from public.events where type = 'contact_created' and organization_id = :'org'), :'c1'::uuid, 'contact_created preenche contact_id');

-- 2. conversation_created como usuário
select tests.authenticate_as(:'uagent');
insert into public.conversations (organization_id, contact_id, channel_id) values (:'org', :'c1', :'ch') returning id as cv1 \gset
select tests.clear_authentication();
select is((select count(*)::int from public.events where type = 'conversation_created' and conversation_id = :'cv1'), 1, 'conversation_created emitido');
select is((select actor_type from public.events where type = 'conversation_created' and conversation_id = :'cv1'), 'user', 'ator user quando autenticado');
select is((select actor_id from public.events where type = 'conversation_created' and conversation_id = :'cv1'), :'uagent'::uuid, 'actor_id = usuário');
select is((select payload->>'channel_id' from public.events where type = 'conversation_created' and conversation_id = :'cv1'), :'ch', 'payload channel_id');
select is((select contact_id from public.events where type = 'conversation_created' and conversation_id = :'cv1'), :'c1'::uuid, 'conversation_created preenche contact_id');

-- 3. como postgres: system
insert into public.conversations (organization_id, contact_id, channel_id) values (:'org', :'c1', :'ch') returning id as cv2 \gset
select is((select actor_type from public.events where type = 'conversation_created' and conversation_id = :'cv2'), 'system', 'ator system sem usuário');
select is((select actor_id from public.events where type = 'conversation_created' and conversation_id = :'cv2'), null::uuid, 'actor_id nulo sem usuário');

-- 4. mensagens
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content)
  values (:'org', :'cv2', :'ch', 'inbound', 'contact', 'oi') returning id as m1 \gset
select is((select count(*)::int from public.events where type = 'message_received' and conversation_id = :'cv2'), 1, 'inbound gera message_received');
select is((select payload->>'message_id' from public.events where type = 'message_received' and conversation_id = :'cv2'), :'m1', 'message_received traz message_id');
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, is_internal_note)
  values (:'org', :'cv2', :'ch', 'outbound', 'human', 'nota', true);
select is((select count(*)::int from public.events where conversation_id = :'cv2' and type in ('message_received', 'ai_replied')), 1, 'nota interna outbound não gera evento');
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content, is_internal_note)
  values (:'org', :'cv2', :'ch', 'inbound', 'contact', 'interna inbound', true);
select is((select count(*)::int from public.events where conversation_id = :'cv2' and type = 'message_received'), 1, 'inbound interna não gera message_received');

-- 5. ai_replied
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content)
  values (:'org', :'cv2', :'ch', 'outbound', 'ai', 'resposta') returning id as m2 \gset
select is((select count(*)::int from public.events where type = 'ai_replied' and conversation_id = :'cv2'), 1, 'sender ai gera ai_replied');
select is((select payload->>'message_id' from public.events where type = 'ai_replied' and conversation_id = :'cv2'), :'m2', 'ai_replied traz message_id');

-- 6. handoff
update public.conversations set status = 'pending_human' where id = :'cv2';
select is((select count(*)::int from public.events where type = 'handoff' and conversation_id = :'cv2'), 1, 'handoff emitido');
select is((select payload->>'from_status' from public.events where type = 'handoff' and conversation_id = :'cv2'), 'open', 'handoff from_status open');
update public.conversations set status = 'pending_human', intent = 'x' where id = :'cv2';
select is((select count(*)::int from public.events where type = 'handoff' and conversation_id = :'cv2'), 1, 'mesmo status não repete handoff');

-- 7. closed
update public.conversations set status = 'closed' where id = :'cv2';
select is((select payload->>'from_status' from public.events where type = 'conversation_closed' and conversation_id = :'cv2'), 'pending_human', 'conversation_closed from_status');
select is((select count(*)::int from public.events where type = 'conversation_closed' and conversation_id = :'cv2'), 1, 'conversation_closed emitido uma vez');

-- 8. deal_created
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
  values (:'org', :'pipe', :'s_novo', :'c1', 'D', 150.50) returning id as d1 \gset
select is((select status::text from public.deals where id = :'d1'), 'open', 'deal em Novo fica open');
select is((select (payload->>'stage_id', payload->>'value')::text from public.events where type = 'deal_created' and deal_id = :'d1'),
  format('(%s,150.50)', :'s_novo'), 'deal_created {stage_id, value}');

-- 9. stage changed
update public.deals set stage_id = :'s_int' where id = :'d1';
select is((select (payload->>'from_stage_id', payload->>'to_stage_id')::text from public.events where type = 'deal_stage_changed' and deal_id = :'d1'),
  format('(%s,%s)', :'s_novo', :'s_int'), 'deal_stage_changed {from,to}');
select is((select status::text from public.deals where id = :'d1'), 'open', 'status open em Interessado');
update public.deals set title = 'D2' where id = :'d1';
select is((select count(*)::int from public.events where type = 'deal_stage_changed' and deal_id = :'d1'), 1, 'sem mudança de etapa, sem evento');

-- 10. won
update public.deals set stage_id = :'s_ganho' where id = :'d1';
select is((select status::text from public.deals where id = :'d1'), 'won', 'etapa is_won => status won');
select is((select payload->>'value' from public.events where type = 'deal_won' and deal_id = :'d1'), '150.50', 'deal_won {value}');

-- 11. insert direto em Perdido
insert into public.contacts (organization_id, name) values (:'org', 'C2') returning id as c2 \gset
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
  values (:'org', :'pipe', :'s_perdido', :'c2', 'L', 10) returning id as d3 \gset
select is((select status::text from public.deals where id = :'d3'), 'lost', 'insert em Perdido => lost');
select is((select array_agg(type order by type) from public.events where deal_id = :'d3'), array['deal_created', 'deal_lost'], 'deal_created e deal_lost');

-- 12. unique de deal aberto continua valendo
insert into public.contacts (organization_id, name) values (:'org', 'C3') returning id as c3 \gset
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title) values (:'org', :'pipe', :'s_ganho', :'c3', 'W') returning id as dw \gset
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title) values (:'org', :'pipe', :'s_novo', :'c3', 'O');
select throws_ok(format($$update public.deals set stage_id = %L where id = %L$$, :'s_novo', :'dw'), '23505', null, 'reabrir deal com outro aberto viola unique');

-- 13. emit_event bloqueado
select tests.authenticate_as(:'uagent');
select throws_ok(format($$select public.emit_event(%L, 'x', null, null, null)$$, :'org'), '42501', null, 'agent não executa emit_event');
select tests.clear_authentication();

-- 14. isolamento
select tests.authenticate_as(:'ub');
select is((select count(*)::int from public.events where organization_id = :'org'), 0, 'outra org não vê eventos');
select tests.clear_authentication();

select * from finish();
rollback;
