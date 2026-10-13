begin;
create extension if not exists pgtap with schema extensions;
select plan(153);
select tests.create_user('owner38@t.test','Dona Ana') as ua \gset
select tests.create_user('agent38@t.test','Beto Agente') as uag \gset
select tests.create_user('viewer38@t.test','Vera Viewer') as uv \gset
select tests.create_user('owner38b@t.test','Outra') as ub \gset
select tests.create_org(:'ua','Org38A') as oa \gset
select tests.create_org(:'ub','Org38B') as ob \gset
select tests.add_member(:'oa',:'uag','agent');
select tests.add_member(:'oa',:'uv','viewer');
update public.organizations set company_info='{"frete":"grátis acima de R$ 200"}' where id=:'oa';

insert into public.pipelines(id,organization_id,name,is_default) values ('00000000-0000-0000-0000-000000003801',:'oa','Padrão',true);
insert into public.pipeline_stages(id,organization_id,pipeline_id,name,position,is_won,is_lost) values
  ('00000000-0000-0000-0000-000000003811',:'oa','00000000-0000-0000-0000-000000003801','Novo',0,false,false),
  ('00000000-0000-0000-0000-000000003812',:'oa','00000000-0000-0000-0000-000000003801','Interessado',1,false,false),
  ('00000000-0000-0000-0000-000000003813',:'oa','00000000-0000-0000-0000-000000003801','Qualificado',2,false,false),
  ('00000000-0000-0000-0000-000000003814',:'oa','00000000-0000-0000-0000-000000003801','Ganho',3,true,false),
  ('00000000-0000-0000-0000-000000003815',:'oa','00000000-0000-0000-0000-000000003801','Perdido',4,false,true);
insert into public.ai_agents(organization_id,name,personality,objective,tone,system_prompt,is_active,auto_reply,human_handoff)
  values (:'oa','Lia','Simpática','Vender','cordial','Seja breve',true,true,true);
insert into public.channels(id,organization_id,type,name,status) values
  ('00000000-0000-0000-0000-000000003821',:'oa','simulator','Sim38','active');
insert into public.tags(id,organization_id,name) values ('00000000-0000-0000-0000-000000003831',:'oa','vip');

-- helpers
create function pg_temp.ingest(p_ext text, p_sender text, p_text text, p_at timestamptz default now()) returns uuid language sql as $$
  select public.ingest_inbound_message('00000000-0000-0000-0000-000000003821', p_ext, p_sender, 'Cliente '||p_sender, p_text, p_at) $$;
create function pg_temp.conv_of(p_msg uuid) returns uuid language sql as $$
  select conversation_id from public.messages where id = p_msg $$;
create function pg_temp.claim(p_conv uuid, p_token uuid) returns uuid language sql as $$
  update public.ai_jobs set state='running', claim_token=p_token, claimed_until=now()+interval '3 minutes', attempts=attempts+1
  where conversation_id=p_conv and kind='reply' and state='pending' returning id $$;
create function pg_temp.res(p_reply text, p_stage text default null, p_score int default 70) returns jsonb language sql as $$
  select jsonb_build_object(
    'classification', jsonb_build_object('intent','duvida','sentiment','positive','lead_score',p_score,'needs_human',false,
      'summary','Quer saber do frete','suggested_stage',p_stage,'model','gpt-4.1-mini'),
    'reply', case when p_reply is null then null else jsonb_build_object('text',p_reply,
      'usedChunkIds',jsonb_build_array('00000000-0000-0000-0000-0000000038ff'),'factCheck',jsonb_build_object('ok',true,'unverified','[]'::jsonb)) end,
    'handoff', null) $$;

-- =============================================================== estrutura e segurança
select has_column('public','conversations','handoff_reason','coluna handoff_reason');
select has_column('public','messages','ai_metadata','coluna ai_metadata');
select ok(has_column_privilege('authenticated','public.conversations','handoff_reason','select'),'authenticated lê handoff_reason');
select ok(not has_column_privilege('authenticated','public.conversations','handoff_reason','update'),'authenticated não atualiza handoff_reason');
select ok(not has_column_privilege('authenticated','public.conversations','handoff_reason','insert'),'authenticated não insere handoff_reason');
select ok(not has_column_privilege('authenticated','public.messages','ai_metadata','update'),'authenticated não atualiza ai_metadata');
select ok(not has_column_privilege('authenticated','public.messages','ai_metadata','insert'),'authenticated não insere ai_metadata');
select ok(not has_function_privilege('authenticated','public.prepare_ai_reply(uuid,uuid)','execute'),'authenticated não executa prepare_ai_reply');
select ok(not has_function_privilege('authenticated','public.complete_ai_reply(uuid,uuid,jsonb)','execute'),'authenticated não executa complete_ai_reply');
select ok(not has_function_privilege('authenticated','public.handoff_ai_job(uuid,uuid,text)','execute'),'authenticated não executa handoff_ai_job');
select ok(not has_function_privilege('authenticated','public.prepare_ai_playground(uuid)','execute'),'authenticated não executa prepare_ai_playground');
select ok(not has_function_privilege('anon','public.return_to_ai(uuid)','execute'),'anon não executa return_to_ai');
select ok(has_function_privilege('authenticated','public.return_to_ai(uuid)','execute'),'authenticated executa return_to_ai');
select ok(has_function_privilege('service_role','public.complete_ai_reply(uuid,uuid,jsonb)','execute'),'service_role executa complete_ai_reply');
select ok(has_function_privilege('service_role','public.prepare_ai_playground(uuid)','execute'),'service_role executa prepare_ai_playground');

-- =============================================================== fila e agrupamento
select pg_temp.ingest('s1','+5511900000001','Oi, qual o frete?',now()-interval '10 minutes') as m1 \gset
select pg_temp.conv_of(:'m1') as c1 \gset
select is((select count(*)::int from public.ai_jobs where conversation_id=:'c1' and kind='reply' and state='pending'),1,'mensagem no Simulador cria 1 tarefa reply');
select is((select run_after from public.ai_jobs where conversation_id=:'c1'),now()+interval '4 seconds','run_after = now() + 4 s');
update public.ai_jobs set run_after=now()-interval '1 second' where conversation_id=:'c1';
select pg_temp.ingest('s2','+5511900000001','E para Campinas?',now()-interval '9 minutes') as m2 \gset
select is((select count(*)::int from public.ai_jobs where conversation_id=:'c1'),1,'segunda mensagem mantém 1 tarefa');
select is((select run_after from public.ai_jobs where conversation_id=:'c1'),now()+interval '4 seconds','segunda mensagem só adia run_after');

-- conversa com humano não cria tarefa
select pg_temp.ingest('h1','+5511900000002','Oi') as mh \gset
select pg_temp.conv_of(:'mh') as ch \gset
update public.conversations set handled_by='human' where id=:'ch';
select is((select state from public.ai_jobs where conversation_id=:'ch'),'cancelled','virar humano cancela a tarefa pendente');
select pg_temp.ingest('h2','+5511900000002','Alô?');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'ch' and state='pending'),0,'handled_by=human não cria tarefa');

-- agente inativo não cria tarefa
select pg_temp.ingest('i1','+5511900000003','Oi') as mi \gset
select pg_temp.conv_of(:'mi') as ci \gset
delete from public.ai_jobs where conversation_id=:'ci';
update public.ai_agents set is_active=false where organization_id=:'oa';
select pg_temp.ingest('i2','+5511900000003','Tem alguém?');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'ci'),0,'agente inativo não cria tarefa');
update public.ai_agents set is_active=true, auto_reply=false where organization_id=:'oa';
select pg_temp.ingest('i3','+5511900000003','E agora?');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'ci'),0,'agente sem auto_reply não cria tarefa');
update public.ai_agents set auto_reply=true where organization_id=:'oa';

-- =============================================================== prepare
select pg_temp.claim(:'c1','00000000-0000-0000-0000-0000000038a1') as j1 \gset
insert into public.contact_tags(organization_id,contact_id,tag_id)
  select :'oa', contact_id, '00000000-0000-0000-0000-000000003831' from public.conversations where id=:'c1';
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status,is_internal_note)
  values (:'oa',:'c1','00000000-0000-0000-0000-000000003821','outbound','system','Nota de sistema','delivered',false),
         (:'oa',:'c1','00000000-0000-0000-0000-000000003821','outbound','human','Nota interna','delivered',true);
select public.prepare_ai_reply(:'j1','00000000-0000-0000-0000-0000000038a1') as p1 \gset
select is(:'p1'::jsonb->>'action','run','prepare devolve run');
select is(:'p1'::jsonb->>'organizationId',:'oa','prepare devolve a organização');
select is(:'p1'::jsonb->>'conversationId',:'c1','prepare devolve a conversa');
select is(:'p1'::jsonb->>'channelType','simulator','prepare devolve o canal');
select is(:'p1'::jsonb->>'lastMessageId',:'m2','lastMessageId é a última mensagem do contato');
select is(:'p1'::jsonb->'agent','{"name":"Lia","personality":"Simpática","objective":"Vender","tone":"cordial","systemPrompt":"Seja breve","humanHandoff":true}'::jsonb,'prepare devolve o agente');
select is(:'p1'::jsonb->'stages','["Novo","Interessado","Qualificado"]'::jsonb,'stages: só etapas abertas, por posição');
select is(:'p1'::jsonb->'conversation','[{"role":"contact","text":"Oi, qual o frete?"},{"role":"contact","text":"E para Campinas?"}]'::jsonb,'conversa sem sistema nem nota interna, mais antiga primeiro');
select is(:'p1'::jsonb->'contact','{"name":"Cliente +5511900000001","tags":["vip"],"stage":null,"leadScore":0}'::jsonb,'prepare devolve o contato');
select is(:'p1'::jsonb->>'company','{"frete": "grátis acima de R$ 200"}','company é o company_info serializado');
select is(public.prepare_ai_reply(:'j1','00000000-0000-0000-0000-0000000038ff')->>'action','skip','token errado devolve skip');
select is((select state from public.ai_jobs where id=:'j1'),'running','token errado não altera a tarefa');

-- RF1: nova mensagem com a tarefa em execução cria outra pendente
select pg_temp.ingest('s3','+5511900000001','Alguém aí?',now()-interval '8 minutes') as m3 \gset
select is((select count(*)::int from public.ai_jobs where conversation_id=:'c1' and state='pending'),1,'RF1: nova mensagem durante running cria tarefa pendente');

-- =============================================================== conclusão no Simulador
select public.complete_ai_reply(:'j1','00000000-0000-0000-0000-0000000038a1',
  pg_temp.res('O frete é grátis acima de R$ 200.')||jsonb_build_object('lastMessageId',:'m2')) as r1 \gset
select is(:'r1'::jsonb,'{"state":"sent","intentIds":[]}'::jsonb,'complete no Simulador devolve sent');
select is((select state from public.ai_jobs where id=:'j1'),'done','tarefa termina done');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'c1' and state='pending'),1,'RF1: complete não cancela a tarefa pendente nova');
select is((select direction::text||'/'||status::text from public.messages where conversation_id=:'c1' and sender_type='ai'),'outbound/delivered','mensagem da IA delivered');
select is((select content from public.messages where conversation_id=:'c1' and sender_type='ai'),'O frete é grátis acima de R$ 200.','conteúdo da resposta');
select is((select ai_metadata from public.messages where conversation_id=:'c1' and sender_type='ai'),
  '{"usedChunkIds":["00000000-0000-0000-0000-0000000038ff"],"factCheck":{"ok":true,"unverified":[]}}'::jsonb,'ai_metadata grava chunks e verificação');
select is((select replies from public.ai_usage_daily where organization_id=:'oa'),1,'complete incrementa replies');
select is((select actor_type||'/'||coalesce(actor_id::text,'null') from public.events where type='ai_replied' and conversation_id=:'c1'),'ai/null','evento ai_replied tem actor_type ai');
select is((select actor_type from public.events where type='message_received' and conversation_id=:'c1' limit 1),'system','message_received segue system');

-- classificação e deal
select is((select intent||'/'||sentiment||'/'||summary from public.conversations where id=:'c1'),'duvida/positive/Quer saber do frete','classificação atualiza a conversa');
select is((select k.lead_score from public.contacts k join public.conversations c on c.contact_id=k.id where c.id=:'c1'),70,'classificação atualiza o lead score');
select is((select message_id from public.ai_classifications where conversation_id=:'c1'),:'m2'::uuid,'ai_classifications aponta o lastMessageId do prepare');
select is((select model from public.ai_classifications where conversation_id=:'c1'),'gpt-4.1-mini','modelo gravado');
select is((select stage_id from public.deals d join public.conversations c on c.contact_id=d.contact_id where c.id=:'c1' and d.status='open'),
  '00000000-0000-0000-0000-000000003811'::uuid,'cria o deal na primeira etapa aberta');

select pg_temp.claim(:'c1','00000000-0000-0000-0000-0000000038a2') as j2 \gset
select public.complete_ai_reply(:'j2','00000000-0000-0000-0000-0000000038a2',pg_temp.res('Posso ajudar?','Qualificado'));
select is((select count(*)::int from public.ai_classifications where conversation_id=:'c1' and message_id=:'m3'),1,'sem lastMessageId usa a última mensagem do contato');
select is((select count(*)::int from public.deals d join public.conversations c on c.contact_id=d.contact_id where c.id=:'c1'),1,'não duplica o deal');
select is((select stage_id from public.deals d join public.conversations c on c.contact_id=d.contact_id where c.id=:'c1'),
  '00000000-0000-0000-0000-000000003813'::uuid,'suggested_stage maior avança o deal');
select pg_temp.ingest('s4','+5511900000001','Ok',now()-interval '7 minutes');
select pg_temp.claim(:'c1','00000000-0000-0000-0000-0000000038a3') as j3 \gset
select public.complete_ai_reply(:'j3','00000000-0000-0000-0000-0000000038a3',pg_temp.res('Certo.','Interessado'));
select is((select stage_id from public.deals d join public.conversations c on c.contact_id=d.contact_id where c.id=:'c1'),
  '00000000-0000-0000-0000-000000003813'::uuid,'suggested_stage menor não move o deal');
select pg_temp.ingest('s5','+5511900000001','Fechado!',now()-interval '6 minutes');
select pg_temp.claim(:'c1','00000000-0000-0000-0000-0000000038a4') as j4 \gset
select public.complete_ai_reply(:'j4','00000000-0000-0000-0000-0000000038a4',pg_temp.res('Ótimo!','Ganho'));
select is((select d.stage_id::text||'/'||d.status::text from public.deals d join public.conversations c on c.contact_id=d.contact_id where c.id=:'c1'),
  '00000000-0000-0000-0000-000000003813/open','etapa de ganho nunca é aplicada');
select is(public.prepare_ai_reply(:'j4','00000000-0000-0000-0000-0000000038a4')->>'action','skip','prepare de tarefa concluída devolve skip');

-- validação do resultado
select pg_temp.ingest('s6','+5511900000001','?',now()-interval '5 minutes');
select pg_temp.claim(:'c1','00000000-0000-0000-0000-0000000038a5') as j5 \gset
select throws_ok(format($$select public.complete_ai_reply(%L,'00000000-0000-0000-0000-0000000038a5','{"classification":null,"reply":null,"handoff":null}')$$,:'j5'),'22023',null,'resultado sem resposta nem transferência é inválido');
select throws_ok(format($$select public.complete_ai_reply(%L,'00000000-0000-0000-0000-0000000038a5','{"classification":null,"reply":null,"handoff":{"reason":"boom"}}')$$,:'j5'),'22023',null,'motivo de transferência desconhecido é inválido');
select throws_ok(format($$select public.complete_ai_reply(%L,'00000000-0000-0000-0000-0000000038a5',%L)$$,:'j5',
  jsonb_set(pg_temp.res('x'),'{classification,lead_score}','101')),'22023',null,'lead_score fora da faixa é inválido');
select throws_ok(format($$select public.complete_ai_reply(%L,'00000000-0000-0000-0000-0000000038a5',%L)$$,:'j5',
  pg_temp.res('x')||jsonb_build_object('lastMessageId',:'mh')),'22023',null,'lastMessageId deve ser mensagem do contato da conversa');
select throws_ok(format($$select public.complete_ai_reply(%L,'00000000-0000-0000-0000-0000000038a5',%L)$$,:'j5',
  jsonb_set(pg_temp.res('x'),'{reply,usedChunkIds}','["nao-uuid"]')),'22023',null,'usedChunkIds precisa ser lista de uuids');
select throws_ok(format($$select public.complete_ai_reply(%L,'00000000-0000-0000-0000-0000000038ff',%L)$$,:'j5',pg_temp.res('x')),'42501',null,'token errado em tarefa existente: 42501');
select is(public.complete_ai_reply(gen_random_uuid(),gen_random_uuid(),pg_temp.res('x')),'{"state":"skipped","intentIds":[]}'::jsonb,'tarefa inexistente: skipped');

-- =============================================================== humano assume
select is((select count(*)::int from public.ai_jobs where conversation_id=:'c1' and state='running'),1,'há uma tarefa em execução');
select pg_temp.ingest('s7','+5511900000001','Mais uma',now()-interval '4 minutes');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'c1' and state='pending'),1,'e uma pendente');
select tests.authenticate_as(:'uag');
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,sender_user_id,content)
  values (:'oa',:'c1','00000000-0000-0000-0000-000000003821','outbound','human',:'uag','Oi, aqui é o Beto');
select tests.clear_authentication();
select is((select handled_by::text from public.conversations where id=:'c1'),'human','resposta humana assume a conversa');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'c1' and state='pending'),0,'resposta humana cancela a pendente');
select count(*)::int as ai_before from public.messages where conversation_id=:'c1' and sender_type='ai' \gset
select is(public.complete_ai_reply(:'j5','00000000-0000-0000-0000-0000000038a5',pg_temp.res('Resposta tardia')),'{"state":"skipped","intentIds":[]}'::jsonb,'RF2: complete após humano assumir é skipped');
select is((select count(*)::int from public.messages where conversation_id=:'c1' and sender_type='ai'),:ai_before,'RF2: sem mensagem da IA');
select is((select state from public.ai_jobs where id=:'j5'),'cancelled','RF2: tarefa cancelada');
select is((select replies from public.ai_usage_daily where organization_id=:'oa'),4,'RF2: cota não consumida');
select is((select count(*)::int from public.ai_classifications where conversation_id=:'c1'),4,'RF2: sem classificação');
select tests.authenticate_as(:'uag');
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,sender_user_id,content,is_internal_note)
  values (:'oa',:'ci','00000000-0000-0000-0000-000000003821','outbound','human',:'uag','nota',true);
select tests.clear_authentication();
select is((select handled_by::text from public.conversations where id=:'ci'),'ai','nota interna não assume a conversa');

-- =============================================================== cota
select pg_temp.ingest('q1','+5511900000004','Oi') as mq \gset
select pg_temp.conv_of(:'mq') as cq \gset
select pg_temp.claim(:'cq','00000000-0000-0000-0000-0000000038b1') as jq \gset
insert into private.ai_limit_overrides(organization_id,daily_replies) values (:'oa',4);
select is(public.prepare_ai_reply(:'jq','00000000-0000-0000-0000-0000000038b1'),format('{"action":"handoff","reason":"quota_exceeded","organizationId":"%s","intentIds":[]}',:'oa')::jsonb,'cota esgotada no prepare: quota_exceeded com organizationId');
select is((select status::text||'/'||handled_by::text||'/'||handoff_reason from public.conversations where id=:'cq'),'pending_human/human/quota_exceeded','cota esgotada transfere');
select is((select state from public.ai_jobs where id=:'jq'),'done','tarefa de cota esgotada termina done');
select is((select count(*)::int from public.ai_classifications where conversation_id=:'cq'),0,'cota esgotada: sem classificação');
-- cota esgotada no complete também transfere
update public.conversations set handled_by='ai', status='open', handoff_reason=null where id=:'cq';
select pg_temp.ingest('q2','+5511900000004','Oi?');
select pg_temp.claim(:'cq','00000000-0000-0000-0000-0000000038b2') as jq2 \gset
update private.ai_limit_overrides set daily_replies=100 where organization_id=:'oa';
select is(public.prepare_ai_reply(:'jq2','00000000-0000-0000-0000-0000000038b2')->>'action','run','cota disponível: run');
update private.ai_limit_overrides set daily_replies=4 where organization_id=:'oa';
select is(public.complete_ai_reply(:'jq2','00000000-0000-0000-0000-0000000038b2',pg_temp.res('oi'))->>'state','handoff','cota esgotada no complete: handoff');
select is((select handoff_reason from public.conversations where id=:'cq'),'quota_exceeded','motivo quota_exceeded');
delete from private.ai_limit_overrides where organization_id=:'oa';

-- =============================================================== transferência
select pg_temp.ingest('t1','+5511900000005','Quero falar com alguém') as mt \gset
select pg_temp.conv_of(:'mt') as ct \gset
update public.conversations set assigned_to=:'uag' where id=:'ct';
select count(*)::int as handoff_events from public.events where type='handoff' and conversation_id=:'ct' \gset
select is(private.ai_handoff(:'ct','needs_human','pediu atendente'),'{}'::uuid[],'ai_handoff no Simulador não cria intents');
select is((select status::text||'/'||handled_by::text||'/'||handoff_reason from public.conversations where id=:'ct'),'pending_human/human/needs_human','ai_handoff aplica a transferência');
select is((select assigned_to from public.conversations where id=:'ct'),:'uag'::uuid,'ai_handoff mantém assigned_to');
select is((select content from public.messages where conversation_id=:'ct' and sender_type='ai'),'Vou te encaminhar para um atendente, só um instante.','human_handoff envia a mensagem de transição exata');
select is((select status::text from public.messages where conversation_id=:'ct' and sender_type='ai'),'delivered','transição no Simulador fica delivered');
select is((select content from public.messages where conversation_id=:'ct' and sender_type='system'),
  'IA transferiu para atendimento humano: Cliente precisa de atendimento humano — pediu atendente','mensagem de sistema contém o rótulo');
select is((select count(*)::int from public.events where type='handoff' and conversation_id=:'ct'),:handoff_events + 1,'evento handoff emitido');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'ct' and state='pending'),0,'ai_handoff cancela a pendente');
select is((select count(*)::int from public.ai_usage_daily where organization_id=:'oa' and replies<>4),0,'ai_handoff não consome cota');
select throws_ok(format($$select private.ai_handoff(%L,'boom',null)$$,:'ct'),'22023',null,'motivo inválido');

update public.ai_agents set human_handoff=false where organization_id=:'oa';
select pg_temp.ingest('t2','+5511900000006','Oi') as mt2 \gset
select pg_temp.conv_of(:'mt2') as ct2 \gset
select private.ai_handoff(:'ct2','injection',null);
select is((select count(*)::int from public.messages where conversation_id=:'ct2' and sender_type='ai'),0,'human_handoff=false não envia transição');
select is((select content from public.messages where conversation_id=:'ct2' and sender_type='system'),'IA transferiu para atendimento humano: Possível tentativa de manipulação da IA','sistema sem detalhe');
update public.ai_agents set human_handoff=true where organization_id=:'oa';

-- handoff vindo do worker no complete
select pg_temp.ingest('t3','+5511900000007','Quanto custa?') as mt3 \gset
select pg_temp.conv_of(:'mt3') as ct3 \gset
select pg_temp.claim(:'ct3','00000000-0000-0000-0000-0000000038c1') as jt3 \gset
select is(public.complete_ai_reply(:'jt3','00000000-0000-0000-0000-0000000038c1',
  jsonb_set(pg_temp.res(null),'{handoff}','{"reason":"no_knowledge","detail":null}')),'{"state":"handoff","intentIds":[]}'::jsonb,'complete com handoff devolve handoff');
select is((select handoff_reason from public.conversations where id=:'ct3'),'no_knowledge','complete aplica o motivo');
select is((select count(*)::int from public.ai_classifications where conversation_id=:'ct3'),1,'classificação gravada mesmo com handoff');
select is((select state from public.ai_jobs where id=:'jt3'),'done','tarefa termina done');

-- atalho do worker
select pg_temp.ingest('t4','+5511900000008','Oi') as mt4 \gset
select pg_temp.conv_of(:'mt4') as ct4 \gset
select pg_temp.claim(:'ct4','00000000-0000-0000-0000-0000000038c2') as jt4 \gset
select throws_ok(format($$select public.handoff_ai_job(%L,'00000000-0000-0000-0000-0000000038ff','not_configured')$$,:'jt4'),'42501',null,'handoff_ai_job com token errado: 42501');
select throws_ok(format($$select public.handoff_ai_job(%L,'00000000-0000-0000-0000-0000000038c2','boom')$$,:'jt4'),'22023',null,'handoff_ai_job com motivo inválido: 22023');
select is(public.handoff_ai_job(:'jt4','00000000-0000-0000-0000-0000000038c2','not_configured'),'{"state":"handoff","intentIds":[]}'::jsonb,'handoff_ai_job devolve intentIds');
select is((select handoff_reason||'/'||(select state from public.ai_jobs where id=:'jt4') from public.conversations where id=:'ct4'),'not_configured/done','handoff_ai_job transfere e encerra');
select is(public.handoff_ai_job(gen_random_uuid(),gen_random_uuid(),'not_configured'),'{"state":"skipped","intentIds":[]}'::jsonb,'handoff_ai_job de tarefa inexistente: skipped');

-- falhas esgotadas
select pg_temp.ingest('t5','+5511900000009','Oi') as mt5 \gset
select pg_temp.conv_of(:'mt5') as ct5 \gset
select pg_temp.claim(:'ct5','00000000-0000-0000-0000-0000000038c3') as jt5 \gset
update public.ai_jobs set attempts=3 where id=:'jt5';
select public.fail_ai_job(:'jt5','00000000-0000-0000-0000-0000000038c3','rate_limited',true);
select is((select status::text||'/'||handoff_reason from public.conversations where id=:'ct5'),'pending_human/ai_failure','fail_ai_job esgotado transfere com ai_failure');
select pg_temp.ingest('t6','+5511900000010','Oi') as mt6 \gset
select pg_temp.conv_of(:'mt6') as ct6 \gset
select pg_temp.claim(:'ct6','00000000-0000-0000-0000-0000000038c4') as jt6 \gset
select public.fail_ai_job(:'jt6','00000000-0000-0000-0000-0000000038c4','not_configured',false);
select is((select handoff_reason from public.conversations where id=:'ct6'),'not_configured','falha not_configured transfere com not_configured');
-- conversa que já saiu da IA não é transferida de novo
select pg_temp.ingest('t8','+5511900000012','Oi') as mt8 \gset
select pg_temp.conv_of(:'mt8') as ct8 \gset
select pg_temp.claim(:'ct8','00000000-0000-0000-0000-0000000038c5') as jt8 \gset
update public.conversations set handled_by='human' where id=:'ct8';
select public.fail_ai_job(:'jt8','00000000-0000-0000-0000-0000000038c5','boom',false);
select is((select status::text||'/'||coalesce(handoff_reason,'null') from public.conversations where id=:'ct8'),'open/null','falha em conversa humana não transfere');

-- =============================================================== return_to_ai
select tests.authenticate_as(:'uv');
select throws_ok(format($$select public.return_to_ai(%L)$$,:'ct'),'42501',null,'viewer não devolve para a IA');
select tests.authenticate_as(:'ub');
select throws_ok(format($$select public.return_to_ai(%L)$$,:'ct'),'42501',null,'outra org não devolve para a IA');
select tests.authenticate_as(:'uag');
select lives_ok(format($$select public.return_to_ai(%L)$$,:'ct'),'agent devolve para a IA');
select tests.clear_authentication();
select is((select status::text||'/'||handled_by::text||'/'||coalesce(handoff_reason,'null')||'/'||coalesce(assigned_to::text,'null') from public.conversations where id=:'ct'),
  'open/ai/null/null','return_to_ai limpa transferência e responsável');
select is((select count(*)::int from public.messages where conversation_id=:'ct' and sender_type='system' and sender_user_id=:'uag'
  and content='Beto Agente devolveu a conversa para a IA'),1,'mensagem de sistema com o nome');
select pg_temp.ingest('t7','+5511900000005','Voltei');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'ct' and state='pending'),1,'após devolver, a IA volta a receber tarefas');
update public.ai_agents set is_active=false where organization_id=:'oa';
select tests.authenticate_as(:'uag');
select throws_ok(format($$select public.return_to_ai(%L)$$,:'ct2'),'22023','ai inactive','agente inativo: 22023');
select tests.clear_authentication();
select pg_temp.claim(:'ct','00000000-0000-0000-0000-0000000038d1') as jr \gset
select is(public.prepare_ai_reply(:'jr','00000000-0000-0000-0000-0000000038d1'),'{"action":"skip"}'::jsonb,'agente desligado: prepare devolve skip');
select is((select state from public.ai_jobs where id=:'jr'),'cancelled','skip cancela a tarefa');
update public.ai_agents set is_active=true where organization_id=:'oa';
-- conversa em pending_human com handled_by ai também é descartada
select pg_temp.ingest('t9','+5511900000005','De novo');
select pg_temp.claim(:'ct','00000000-0000-0000-0000-0000000038d2') as jr2 \gset
update public.conversations set status='pending_human' where id=:'ct';
select is(public.prepare_ai_reply(:'jr2','00000000-0000-0000-0000-0000000038d2'),'{"action":"skip"}'::jsonb,'pending_human: prepare devolve skip');

-- =============================================================== Instagram
select public.save_instagram_connection(:'ua',:'oa','{"appId":"138","appSecret":"app","accessToken":"access","accountId":"78938","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select count(*)::int as jobs_before_comment from public.ai_jobs \gset
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78938','externalId','c38','commentId','c38','mediaId','80038','senderExternalId','93801','text','quanto custa?','occurredAt',now()));
select is((select count(*)::int from public.ai_jobs),:jobs_before_comment,'comentário do Instagram não cria tarefa');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78938','externalId','dm38','senderExternalId','93802','senderName','Ig','text','Oi pelo Direct','occurredAt',now())) as ev1 \gset
select (select conversation_id from public.messages where id=(:'ev1'::jsonb->>'messageId')::uuid) as cig \gset
select is((select count(*)::int from public.ai_jobs where conversation_id=:'cig' and state='pending'),1,'Direct do Instagram cria tarefa');
select pg_temp.claim(:'cig','00000000-0000-0000-0000-0000000038e1') as jig \gset
select is(public.prepare_ai_reply(:'jig','00000000-0000-0000-0000-0000000038e1')->>'channelType','instagram','prepare no Instagram');
select public.complete_ai_reply(:'jig','00000000-0000-0000-0000-0000000038e1',pg_temp.res('Olá pelo Direct!')) as rig \gset
select is(:'rig'::jsonb->>'state','queued','complete no Instagram devolve queued');
select is((select coalesce(actor_id::text,'null')||'/'||request_id::text||'/'||recipient_external_id||'/'||kind||'/'||state from public.instagram_send_intents where id=(:'rig'::jsonb->'intentIds'->>0)::uuid),
  'null/'||:'jig'||'/93802/direct/pending','intent direto sem ator, request_id = tarefa');
select is((select m.sender_type::text||'/'||m.status::text||'/'||m.content from public.messages m join public.instagram_send_intents i on i.message_id=m.id
  where i.id=(:'rig'::jsonb->'intentIds'->>0)::uuid),'ai/pending/Olá pelo Direct!','mensagem pending sender_type ai');
select is((select replies from public.ai_usage_daily where organization_id=:'oa'),5,'resposta no Instagram consome cota');

-- RF5: janela de 24h fechada
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78938','externalId','dm38old','senderExternalId','93803','senderName','Velho','text','Oi antigo','occurredAt',now()-interval '25 hours')) as ev2 \gset
select (select conversation_id from public.messages where id=(:'ev2'::jsonb->>'messageId')::uuid) as cold \gset
select pg_temp.claim(:'cold','00000000-0000-0000-0000-0000000038e2') as jold \gset
select is(public.complete_ai_reply(:'jold','00000000-0000-0000-0000-0000000038e2',pg_temp.res('Tarde demais')),'{"state":"handoff","intentIds":[]}'::jsonb,'RF5: janela fechada vira handoff');
select is((select handoff_reason from public.conversations where id=:'cold'),'window_closed','RF5: motivo window_closed');
select is((select count(*)::int from public.instagram_send_intents where conversation_id=:'cold'),0,'RF5: sem intent');
select is((select count(*)::int from public.messages where conversation_id=:'cold' and sender_type='ai'),0,'RF5: sem mensagem da IA');
select is((select replies from public.ai_usage_daily where organization_id=:'oa'),5,'RF5: cota não consumida');

-- resposta longa demais para o Instagram
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78938','externalId','dm38long','senderExternalId','93805','senderName','L','text','Conte tudo','occurredAt',now())) as ev4 \gset
select (select conversation_id from public.messages where id=(:'ev4'::jsonb->>'messageId')::uuid) as clong \gset
select pg_temp.claim(:'clong','00000000-0000-0000-0000-0000000038e4') as jlong \gset
select public.complete_ai_reply(:'jlong','00000000-0000-0000-0000-0000000038e4',pg_temp.res(repeat('é',501)));
select is((select handoff_reason from public.conversations where id=:'clong'),'reply_too_long','resposta > 1000 bytes no Instagram: reply_too_long');

-- transição no Instagram com janela aberta vira intent
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78938','externalId','dm38h','senderExternalId','93804','senderName','H','text','Atendente?','occurredAt',now())) as ev3 \gset
select (select conversation_id from public.messages where id=(:'ev3'::jsonb->>'messageId')::uuid) as cih \gset
select private.ai_handoff(:'cih','needs_human',null) as hint \gset
select is((select text||'/'||coalesce(actor_id::text,'null') from public.instagram_send_intents where id=(:'hint'::uuid[])[1]),
  'Vou te encaminhar para um atendente, só um instante./null','transição no Instagram vira intent');

-- =============================================================== desistência não envia aviso de transição
select is((select count(*)::int from public.messages where conversation_id=:'ct5' and sender_type='ai'),0,'desistência no Simulador não envia aviso');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78938','externalId','dm38g1','senderExternalId','93806','senderName','G1','text','Oi','occurredAt',now())) as evg1 \gset
select (select conversation_id from public.messages where id=(:'evg1'::jsonb->>'messageId')::uuid) as cg1 \gset
select pg_temp.claim(:'cg1','00000000-0000-0000-0000-0000000038f1') as jg1 \gset
update public.ai_jobs set attempts=3 where id=:'jg1';
select count(*)::int as hev_g1 from public.events where type='handoff' and conversation_id=:'cg1' \gset
select public.fail_ai_job(:'jg1','00000000-0000-0000-0000-0000000038f1','rate_limited',true);
select is((select status::text||'/'||handled_by::text||'/'||handoff_reason from public.conversations where id=:'cg1'),'pending_human/human/ai_failure','desistência no Instagram transfere com ai_failure');
select is((select count(*)::int from public.instagram_send_intents where conversation_id=:'cg1'),0,'desistência no Instagram não cria intent');
select is((select count(*)::int from public.messages where conversation_id=:'cg1' and sender_type='ai'),0,'desistência no Instagram não grava mensagem da IA');
select is((select count(*)::int from public.messages where conversation_id=:'cg1' and sender_type='system' and content='IA transferiu para atendimento humano: Falha temporária da IA'),1,'desistência grava a nota de sistema');
select is((select count(*)::int from public.events where type='handoff' and conversation_id=:'cg1'),:hev_g1 + 1,'desistência emite handoff');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78938','externalId','dm38g2','senderExternalId','93807','senderName','G2','text','Oi','occurredAt',now())) as evg2 \gset
select (select conversation_id from public.messages where id=(:'evg2'::jsonb->>'messageId')::uuid) as cg2 \gset
select pg_temp.claim(:'cg2','00000000-0000-0000-0000-0000000038f2') as jg2 \gset
update public.ai_jobs set attempts=3, claimed_until=now()-interval '1 second' where id=:'jg2';
select public.sweep_ai_jobs();
select is((select handoff_reason from public.conversations where id=:'cg2'),'ai_failure','varredura esgotada transfere com ai_failure');
select is((select count(*)::int from public.instagram_send_intents where conversation_id=:'cg2'),0,'varredura esgotada não cria intent');
select is((select count(*)::int from public.messages where conversation_id=:'cg2' and sender_type='ai'),0,'varredura esgotada não grava mensagem da IA');

-- =============================================================== return_to_ai: guardas
insert into public.channels(id,organization_id,type,name,status) values ('00000000-0000-0000-0000-000000003822',:'oa','whatsapp','WA38','active');
insert into public.contacts(id,organization_id,name) values ('00000000-0000-0000-0000-000000003832',:'oa','Zap');
insert into public.conversations(id,organization_id,contact_id,channel_id,status,handled_by) values
  ('00000000-0000-0000-0000-000000003841',:'oa','00000000-0000-0000-0000-000000003832','00000000-0000-0000-0000-000000003822','pending_human','human');
select tests.authenticate_as(:'uag');
select throws_ok($$select public.return_to_ai('00000000-0000-0000-0000-000000003841')$$,'22023','ai unsupported channel','canal sem IA: 22023');
select tests.clear_authentication();
select pg_temp.ingest('r1','+5511900000013','Oi') as mr \gset
select pg_temp.conv_of(:'mr') as crn \gset
select tests.authenticate_as(:'uag');
select public.return_to_ai(:'crn');
select tests.clear_authentication();
select is((select count(*)::int from public.messages where conversation_id=:'crn' and sender_type='system'),0,'já com a IA: return_to_ai não grava nota');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'crn' and state='pending'),1,'já com a IA: tarefa pendente intacta');
select pg_temp.claim(:'crn','00000000-0000-0000-0000-0000000038f3') as jrn \gset
update public.conversations set handled_by='human' where id=:'crn';
select tests.authenticate_as(:'uag');
select public.return_to_ai(:'crn');
select tests.clear_authentication();
select is((select state from public.ai_jobs where id=:'jrn'),'cancelled','return_to_ai cancela a tarefa em execução');
select is((select count(*)::int from public.messages where conversation_id=:'crn' and sender_type='system' and content='Beto Agente devolveu a conversa para a IA'),1,'devolução grava a nota uma vez');
select is(public.complete_ai_reply(:'jrn','00000000-0000-0000-0000-0000000038f3',pg_temp.res('tarde')),'{"state":"skipped","intentIds":[]}'::jsonb,'complete de tarefa cancelada: skipped');
select is(public.handoff_ai_job(:'jrn','00000000-0000-0000-0000-0000000038f3','needs_human'),'{"state":"skipped","intentIds":[]}'::jsonb,'handoff_ai_job de tarefa cancelada: skipped');
select is((select count(*)::int from public.messages where conversation_id=:'crn' and sender_type='ai'),0,'tarefa cancelada não grava resposta');

-- =============================================================== reabrir limpa o motivo
update public.conversations set status='closed' where id=:'ct2';
select pg_temp.ingest('t10','+5511900000006','Voltei de novo');
select is((select status::text||'/'||coalesce(handoff_reason,'null') from public.conversations where id=:'ct2'),'open/null','reabrir conversa fechada limpa handoff_reason');

-- =============================================================== integridade e playground
select throws_ok(format($$update public.conversations set handoff_reason='boom' where id=%L$$,:'c1'),'23514',null,'handoff_reason aceita só os códigos');
select tests.authenticate_as(:'uag');
select throws_ok(format($$update public.conversations set handoff_reason='injection' where id=%L$$,:'c1'),'42501',null,'agent não grava handoff_reason');
select throws_ok(format($$update public.messages set ai_metadata='{}' where conversation_id=%L$$,:'c1'),'42501',null,'agent não grava ai_metadata');
select tests.clear_authentication();
select pg_temp.ingest('f1','+5511900000011','Outra conversa') as mf \gset
select throws_ok(format($$insert into public.ai_classifications(organization_id,message_id,conversation_id,sentiment,lead_score,needs_human,model)
  values (%L,%L,%L,'neutral',10,false,'m')$$,:'oa',:'mf',:'c1'),'23503',null,'FK recusa mensagem de outra conversa');
select is(public.prepare_ai_playground(:'oa')->'stages','["Novo","Interessado","Qualificado"]'::jsonb,'playground devolve as etapas');
select is(public.prepare_ai_playground(:'oa')->'agent'->>'name','Lia','playground devolve o agente');
select is(public.prepare_ai_playground(:'oa')->>'company','{"frete": "grátis acima de R$ 200"}','playground devolve a empresa');

select * from finish();
rollback;
