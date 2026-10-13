begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_column('public','instagram_events','automation_id','comment snapshot identifies automation');
select has_column('public','instagram_events','automation_version','comment snapshot freezes version');
select ok(not has_function_privilege('authenticated','public.save_instagram_comment_rule(jsonb)','execute'),'legacy REST authoring denied');
select ok(not has_table_privilege('authenticated','public.instagram_comment_rules','insert'),'legacy table is read-only');
select tests.create_user('owner42@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org42') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"142","appSecret":"app","accessToken":"access","accountId":"78942","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn, (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select public.verify_instagram_media(:'conn',:'chan','80042',1);
insert into public.instagram_comment_rules(organization_id,channel_id,keyword,reply_text,active,media_id,updated_at) values
 (:'oa',:'chan','guia','Olá {nome}, escolha',true,'80042',now()-interval '1 hour') returning id as auto \gset
insert into public.instagram_comment_rules(organization_id,channel_id,keyword,reply_text,active) values
 (:'oa',:'chan','inativo','Rascunho',false) returning id as draft \gset
select private.migrate_instagram_comment_rules();
select is((select status::text from public.automations where id=:'auto'),'active','active legacy rule migrated');
select is((select current_version from public.automations where id=:'auto'),1,'active legacy version one');
select is((select status::text from public.automations where id=:'draft'),'draft','inactive legacy rule becomes draft');
select is((select count(*)::int from public.automation_nodes where automation_id=:'draft'),3,'draft graph migrated');
select (select id from public.automation_nodes where automation_id=:'auto' and type='message') as node \gset
update public.automation_nodes set config=config||'{"buttons":[{"id":"yes","title":"Sim","kind":"path"},{"id":"site","title":"Site","kind":"url","url":"https://example.com"}]}' where id=:'node';
update public.automation_versions set graph=private.automation_graph(:'oa',:'auto') where automation_id=:'auto';
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78942','externalId','comment42','commentId','comment42','mediaId','80042','senderExternalId','944','text','Quero o GUIÁ','occurredAt',now())) as ce \gset
select (:'ce'::jsonb->>'eventId') as cev \gset
select is((select automation_id from public.instagram_events where id=:'cev'),:'auto'::uuid,'comment matches normalized automation keywords');
select is((select automation_version from public.instagram_events where id=:'cev'),1,'comment freezes version');
select is((select rule_id from public.instagram_events where id=:'cev'),null::uuid,'new comments leave historical rule fields null');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78942','externalId','nomatch42','commentId','nomatch42','mediaId','80042','senderExternalId','944','text','outro','occurredAt',now()))->>'state','ignored','nonmatching comment ignored');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78942','externalId','wrongmedia42','commentId','wrongmedia42','mediaId','80043','senderExternalId','944','text','guia','occurredAt',now()))->>'state','ignored','different media ignored');
select public.prepare_instagram_comment_send(:'cev') as prepared \gset
select (:'prepared'::jsonb->>'intentId') as intent \gset
select is((select text from public.instagram_send_intents where id=:'intent'),'Olá, escolha','null name and excess space rendered');
select is((select count(*)::int from public.automation_runs where automation_id=:'auto'),0,'prepare before proof creates no run');
select (select message_payload#>>'{attachment,payload,buttons,0,payload}' from public.instagram_send_intents where id=:'intent') as payload \gset
select ok(private.automation_verify_payload(:'payload') is not null,'first reply path payload is signed');
select is((select message_payload#>>'{attachment,payload,buttons,1,type}' from public.instagram_send_intents where id=:'intent'),'web_url','URL button body');
select private.instagram_comment_body((select automation_run_id from public.instagram_events where id=:'cev'),
  jsonb_build_object('id',:'node','type','message','config',jsonb_build_object('mode','text','text','Oi {primeiro_nome}!',
    'quickReplies',jsonb_build_array(jsonb_build_object('id','quick','title','Quero'))))) as quickbody \gset
select is(:'quickbody'::jsonb->>'text','Oi!','quick-reply first body renders null name');
select is(private.automation_verify_payload(:'quickbody'::jsonb#>>'{quick_replies,0,payload}')->>'optionId','quick','first quick-reply body signs its own option');
select tests.authenticate_as(:'ua');
select public.pause_automation(:'auto');
select tests.clear_authentication();
select public.claim_instagram_send(:'intent') as claim \gset
select (select automation_run_id from public.instagram_send_intents where id=:'intent') as run \gset
select is((select version from public.automation_runs where id=:'run'),1,'paused flow claims frozen version');
select is((select resume_at from public.automation_runs where id=:'run'),null::timestamptz,'unconfirmed first send is parked');
select is((select output->>'result' from public.automation_run_steps where run_id=:'run'),'private_reply_pending','unconfirmed send not recorded as sent');
select is(public.claim_instagram_send(:'intent'),'null'::jsonb,'private reply cannot be claimed twice');
select public.complete_instagram_send(:'intent',jsonb_build_object('claimToken',:'claim'::jsonb->>'claimToken','state','sent','externalId','private42','recipientId','944'));
select is((select waiting_for from public.automation_runs where id=:'run'),'reply','private completion waits for reply');
select is((select wait_node_id from public.automation_runs where id=:'run'),:'node'::uuid,'waits on first message');
select is((select output->>'result' from public.automation_run_steps where run_id=:'run'),'sent','successful first send recorded');
select is((select automation_run_id from public.conversations where id=(select conversation_id from public.automation_runs where id=:'run')),:'run'::uuid,'run linked to created conversation');
select ok((select contact_id is not null from public.automation_runs where id=:'run'),'run linked to created contact');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','accountId','78942','externalId','forged42','senderExternalId','944','title','Sim','payload',:'payload'||'x','occurredAt',now()))->>'state','ignored','forged Sim click never falls back to title');
select is((select input from public.automation_runs where id=:'run'),null::jsonb,'forged payload cannot resume');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','accountId','78942','externalId','wrongsender42','senderExternalId','946','title','Sim','payload',:'payload','occurredAt',now()))->>'state','ignored','valid payload from wrong sender ignored');
select is((select count(*)::int from public.contacts where organization_id=:'oa' and instagram_id='946'),0,'rejected click creates no contact');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','accountId','78942','externalId','wrongnode42','senderExternalId','944','title','Sim','payload',private.automation_payload(:'run',gen_random_uuid(),'yes'),'occurredAt',now()))->>'state','ignored','valid signature for wrong node ignored');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','accountId','78942','externalId','wrongoption42','senderExternalId','944','title','Sim','payload',private.automation_payload(:'run',:'node','absent'),'occurredAt',now()))->>'state','ignored','valid signature for nonexistent option ignored');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','accountId','78942','externalId','resume42','senderExternalId','944','title','Sim','payload',:'payload','occurredAt',now())) as resumed \gset
select is((select input->>'optionId' from public.automation_runs where id=:'run'),'yes','signed postback resumes with option');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','accountId','78942','externalId','resume42','senderExternalId','944','title','DUP','payload',:'payload','occurredAt',now())),:'resumed'::jsonb,'signed postback duplicate ignored');
select is((select count(*)::int from public.messages where external_id='resume42'),1,'replay creates one inbound');
select is((select context->>'origin' from public.messages where external_id='resume42'),'button','postback context is supplied at insert');
select is((select content from public.messages where external_id='resume42'),'Sim','valid button title becomes inbound text');
select is((select count(*)::int from public.events where type='button_clicked' and payload->>'runId'=:'run'),1,'valid click emits one domain event');
select (:'resumed'::jsonb->>'eventId') as buttonid \gset
select is(public.prepare_instagram_profile(:'buttonid')->>'senderExternalId','944','button keeps profile lookup contract');
select tests.authenticate_as(:'ua');
select public.activate_automation(:'auto');
select tests.clear_authentication();
select (public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78942','externalId','quickcomment42','commentId','quickcomment42','mediaId','80042','senderExternalId','947','text','guia','occurredAt',now()))->>'eventId') as qev \gset
select (public.prepare_instagram_comment_send(:'qev')->>'intentId') as qi \gset
select public.claim_instagram_send(:'qi') as qc \gset
select public.complete_instagram_send(:'qi',jsonb_build_object('claimToken',:'qc'::jsonb->>'claimToken','state','sent','externalId','privatequick42','recipientId','947'));
select (select message_payload#>>'{attachment,payload,buttons,0,payload}' from public.instagram_send_intents where id=:'qi') as qpayload \gset
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78942','externalId','quick42','senderExternalId','947','text','Sim','occurredAt',now(),'context',jsonb_build_object('origin','quick_reply','payload',:'qpayload')));
select is((select context->>'payload' from public.messages where external_id='quick42'),:'qpayload','quick-reply payload preserved before dispatch');
select is((select input->>'optionId' from public.automation_runs where id=(select automation_run_id from public.instagram_send_intents where id=:'qi')),'yes','quick reply resumes option before dispatch');
-- Pending private deliveries remain outside the automation queue on every failure path.
create function pg_temp.comment_intent(p_conn uuid,p_id text,p_sender text) returns uuid language plpgsql as $$
declare ev uuid;
begin
  ev:=(public.ingest_instagram_event(p_conn,jsonb_build_object('kind','comment','accountId','78942','externalId',p_id,
    'commentId',p_id,'mediaId','80042','senderExternalId',p_sender,'text','guia','occurredAt',now()))->>'eventId')::uuid;
  return (public.prepare_instagram_comment_send(ev)->>'intentId')::uuid;
end $$;
select pg_temp.comment_intent(:'conn','failed42','948') as fi \gset
select public.claim_instagram_send(:'fi') as fc \gset
select public.complete_instagram_send(:'fi',jsonb_build_object('claimToken',:'fc'::jsonb->>'claimToken','state','failed','errorCode','provider_rejected'));
select is((select status::text from public.automation_runs where id=(select automation_run_id from public.instagram_send_intents where id=:'fi')),'failed','definitive private failure fails run');
select is((select status::text from public.automation_run_steps where run_id=(select automation_run_id from public.instagram_send_intents where id=:'fi')),'failed','definitive failure fails first step');
select pg_temp.comment_intent(:'conn','uncertain42','949') as ui \gset
select public.claim_instagram_send(:'ui') as uc \gset
select public.complete_instagram_send(:'ui',jsonb_build_object('claimToken',:'uc'::jsonb->>'claimToken','state','uncertain','errorCode','network_ambiguous'));
select is((select status::text from public.automation_runs where id=(select automation_run_id from public.instagram_send_intents where id=:'ui')),'failed','uncertain send fails safe without runnable orphan');
select is(public.claim_instagram_send(:'ui'),'null'::jsonb,'uncertain private reply never automatically resent');
select pg_temp.comment_intent(:'conn','rate42','950') as ri \gset
select public.claim_instagram_send(:'ri') as rc \gset
select public.complete_instagram_send(:'ri',jsonb_build_object('claimToken',:'rc'::jsonb->>'claimToken','state','failed','errorCode','rate_limited'));
select is((select status::text||'/'||coalesce(resume_at::text,'null') from public.automation_runs where id=(select automation_run_id from public.instagram_send_intents where id=:'ri')),'waiting/null','rate limited run remains parked');
select (select event_id from public.instagram_send_intents where id=:'ri') as rev \gset
select public.prepare_instagram_comment_send(:'rev');
select public.claim_instagram_send(:'ri') as rc2 \gset
select is((select count(*)::int from public.automation_runs where id=(select automation_run_id from public.instagram_send_intents where id=:'ri')),1,'rate retry reuses the same run');
select public.complete_instagram_send(:'ri',jsonb_build_object('claimToken',:'rc2'::jsonb->>'claimToken','state','sent','externalId','privateRate42','recipientId','950'));
select (select message_payload#>>'{attachment,payload,buttons,0,payload}' from public.instagram_send_intents where id=:'ri') as rpayload \gset
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78942','externalId','typed42','senderExternalId','950','text','Sim','occurredAt',now()));
select is((select input->>'text' from public.automation_runs where id=(select automation_run_id from public.instagram_send_intents where id=:'ri')),'Sim','ordinary typed title still resumes text resolution');
select pg_temp.comment_intent(:'conn','lease42','951') as li \gset
select public.claim_instagram_send(:'li');
update public.instagram_send_intents set claimed_at=now()-interval '2 minutes' where id=:'li';
select is(public.claim_instagram_send(:'li'),'null'::jsonb,'expired private lease never sends twice');
select is((select status::text from public.automation_runs where id=(select automation_run_id from public.instagram_send_intents where id=:'li')),'failed','expired lease leaves failed safe run');
select pg_temp.comment_intent(:'conn','scope42','952') as si \gset
select public.claim_instagram_send(:'si') as sc \gset
select public.complete_instagram_send(:'si',jsonb_build_object('claimToken',:'sc'::jsonb->>'claimToken','state','sent','externalId','privateScope42','recipientId','952'));
select (select message_payload#>>'{attachment,payload,buttons,0,payload}' from public.instagram_send_intents where id=:'si') as spayload \gset
select tests.create_user('other42@t.test','Other') as other \gset
select tests.create_org(:'other','Other42') as otherorg \gset
select public.save_instagram_connection(:'other',:'otherorg','{"appId":"143","appSecret":"app","accessToken":"access","accountId":"78943","apiVersion":"v26.0"}') as other_saved \gset
select (:'other_saved'::jsonb->>'connectionId') as otherconn \gset
select public.set_meta_connection_verification(:'otherconn','token',true,null,1);
select public.set_meta_connection_verification(:'otherconn','webhook',true,null,1);
select is(public.ingest_instagram_event(:'otherconn',jsonb_build_object('kind','button','accountId','78943','externalId','crossorg42','senderExternalId','952','title','Sim','payload',:'spayload','occurredAt',now()))->>'state','ignored','cross-organization click payload ignored for active waiting run');
select is((select input from public.automation_runs where id=(select automation_run_id from public.instagram_send_intents where id=:'si')),null::jsonb,'cross-organization payload cannot resume the valid run');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78942','externalId','invalidquick42','senderExternalId','952','text','Sim','occurredAt',now(),'context',jsonb_build_object('origin','quick_reply','payload','forged')))->>'state','ignored','invalid quick reply cannot fall back to typed title');
select pg_temp.comment_intent(:'conn','exhausted42','953') as ei \gset
select public.claim_instagram_send(:'ei') as ec \gset
select public.complete_instagram_send(:'ei',jsonb_build_object('claimToken',:'ec'::jsonb->>'claimToken','state','failed','errorCode','rate_limited'));
select (select event_id from public.instagram_send_intents where id=:'ei') as eev \gset
update public.instagram_events set attempts=4 where id=:'eev';
select public.finish_instagram_work((select msg_id from pgmq.q_instagram_work where message->>'eventId'=:'eev'),'retry','rate_limited');
select is((select status::text from public.automation_runs where id=(select automation_run_id from public.instagram_send_intents where id=:'ei')),'failed','exhausted verification retries terminate parked run');
select is(private.automation_render_null_name(E'Oi, {nome}!\n{primeiro_nome} olá'),'Oi!'||E'\n'||'olá','null-name rendering preserves newlines and punctuation');
delete from public.contacts where organization_id=:'oa' and instagram_id='944';
select is((select payload from public.instagram_events where id=:'buttonid'),'{"purged":true}'::jsonb,'contact deletion purges button raw payload');
select is((select status::text from public.automation_runs where id=:'run'),'cancelled','contact deletion cancels frozen comment execution');
-- Deterministic A -> stop -> B transition: A's signed title must never resume B.
select (select conversation_id from public.automation_runs where id=(select automation_run_id from public.instagram_send_intents where id=:'si')) as scopeconv \gset
select tests.authenticate_as(:'ua');
select public.stop_automation(:'scopeconv');
select tests.clear_authentication();
select pg_temp.comment_intent(:'conn','scopeB42','952') as bi \gset
select public.claim_instagram_send(:'bi') as bc \gset
select public.complete_instagram_send(:'bi',jsonb_build_object('claimToken',:'bc'::jsonb->>'claimToken','state','sent','externalId','privateScopeB42','recipientId','952'));
select (select automation_run_id from public.instagram_send_intents where id=:'bi') as brun \gset
select is(public.ingest_inbound_message(:'chan','stale7arg42','952',null,'Sim',now(),jsonb_build_object('origin','button','payload',:'spayload')),null::uuid,'7-arg stale A payload rejected while B waits');
select is((select input from public.automation_runs where id=:'brun'),null::jsonb,'stale signed A title does not resume B');
select is((select count(*)::int from public.messages where external_id='stale7arg42'),0,'rejected stale context creates no inbound');
select is(public.ingest_inbound_message(:'chan','forged7arg42','952',null,'Sim',now(),'{"origin":"quick_reply","payload":"forged"}'),null::uuid,'7-arg forged quick-reply title rejected');
select is((select input from public.automation_runs where id=:'brun'),null::jsonb,'forged context does not resume B');
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status,external_id,context)
 values(:'oa',:'scopeconv',:'chan','inbound','contact','Sim','delivered','rawStale42',jsonb_build_object('origin','button','payload',:'spayload'));
select is((select input from public.automation_runs where id=:'brun'),null::jsonb,'shared trigger independently rejects stale A payload while B waits');
select public.ingest_inbound_message(:'chan','typedB42','952',null,'Sim',now(),'{}');
select is((select input->>'text' from public.automation_runs where id=:'brun'),'Sim','ordinary typed title still resumes B');
select is((select input->>'optionId' from public.automation_runs where id=:'brun'),null::text,'ordinary typed title remains a text reply');
select tests.authenticate_as(:'ua');
select public.stop_automation(:'scopeconv');
select tests.clear_authentication();
insert into public.ai_agents(organization_id,name,personality,objective,tone,system_prompt,is_active,auto_reply)
  values(:'oa','AI','Cordiale','Atender','cordial','Responda',true,true);
update public.conversations set handled_by='ai' where id=:'scopeconv';
insert into public.automations(organization_id,name,status,trigger_type,trigger_config,current_version,activated_at)
 values(:'oa','Other flow','active','keyword_detected','{"keywords":["Sim"],"mode":"equals"}',1,now()) returning id as otherflow \gset
insert into public.automation_versions(organization_id,automation_id,version,trigger_type,trigger_config,graph)
 values(:'oa',:'otherflow',1,'keyword_detected','{"keywords":["Sim"],"mode":"equals"}','{"nodes":[{"id":"00000000-0000-4000-8000-000000004251","type":"trigger","config":{}}],"edges":[]}');
select is(public.ingest_inbound_message(:'chan','staleNoRun42','952',null,'Sim',now(),jsonb_build_object('origin','button','payload',:'spayload')),null::uuid,'stale context with no waiting run is ignored');
select is((select count(*)::int from public.automation_runs where automation_id=:'otherflow'),0,'stale context cannot trigger another keyword flow');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'scopeconv'),0,'stale context cannot enqueue AI');
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,status,external_id,context)
 values(:'oa',:'scopeconv',:'chan','inbound','contact','Sim','delivered','rawForged42','{"origin":"button","payload":"forged"}');
select is((select count(*)::int from public.automation_runs where automation_id=:'otherflow'),0,'shared trigger cannot dispatch keyword flow for invalid supplied context');
select is((select count(*)::int from public.ai_jobs where conversation_id=:'scopeconv'),0,'AI trigger independently ignores invalid supplied context');
insert into public.automations(organization_id,name,status,trigger_type,current_version,activated_at)
 values(:'oa','Contact flow','active','contact_created',1,now()) returning id as contactflow \gset
insert into public.automation_versions(organization_id,automation_id,version,trigger_type,graph)
 values(:'oa',:'contactflow',1,'contact_created','{"nodes":[{"id":"00000000-0000-4000-8000-000000004252","type":"trigger","config":{}}],"edges":[]}');
select is(public.ingest_inbound_message(:'chan','newForged42','989',null,'Sim',now(),'{"origin":"button","payload":"forged"}'),null::uuid,'forged context for unknown sender ignored before contact creation');
select is((select count(*)::int from public.contacts where organization_id=:'oa' and instagram_id='989'),0,'forged context creates no contact');
select is((select count(*)::int from public.automation_runs where automation_id=:'contactflow'),0,'forged context cannot trigger CRM flow');
select tests.authenticate_as(:'ua');
select throws_ok(format('insert into public.instagram_comment_rules(organization_id,channel_id,keyword,reply_text) values(%L,%L,''x'',''x'')',:'oa',:'chan'),'42501',null,'legacy insert actually denied');
select throws_ok(format('update public.instagram_comment_rules set active=false where id=%L',:'auto'),'42501',null,'legacy update actually denied');
select throws_ok('select public.save_instagram_comment_rule(''{}''::jsonb)','42501',null,'legacy RPC actually denied');
select is((select count(*)::int from public.automations where organization_id=:'otherorg'),0,'automation RLS excludes foreign organization');
select tests.clear_authentication();
insert into public.automations(organization_id,name,status,trigger_type,trigger_config,current_version,activated_at)
 values(:'oa','Story','active','instagram_story',jsonb_build_object('channelId',:'chan'),1,now()) returning id as story \gset
insert into public.automation_versions(organization_id,automation_id,version,trigger_type,trigger_config,graph)
 values(:'oa',:'story',1,'instagram_story',jsonb_build_object('channelId',:'chan'),'{"nodes":[{"id":"00000000-0000-4000-8000-000000004201","type":"trigger","config":{}}],"edges":[]}');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78942','externalId','story42','senderExternalId','942','text','Olá','occurredAt',now(),'context',jsonb_build_object('origin','story_reply'))) as story_event \gset
select is((select count(*)::int from public.automation_runs where automation_id=:'story'),1,'story context dispatches before insert trigger');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','accountId','78942','externalId','button42','senderExternalId','943','title','Sim','payload','invalid','occurredAt',now())) as button_event \gset
select is(:'button_event'::jsonb->>'state','ignored','invalid button signature ignored');
select is((select count(*)::int from public.messages where external_id='button42'),0,'invalid button creates no inbound');
select is(public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','accountId','78942','externalId','button42','senderExternalId','943','title','Sim','payload','invalid','occurredAt',now())),:'button_event'::jsonb,'postback replay is idempotent');
select is(private.instagram_comment_first_node('{"nodes":[{"id":"00000000-0000-4000-8000-000000004211","type":"trigger"},{"id":"00000000-0000-4000-8000-000000004212","type":"message","config":{"mode":"ai"}}],"edges":[{"source":"00000000-0000-4000-8000-000000004211","target":"00000000-0000-4000-8000-000000004212","sourceHandle":"default"}]}'),null::jsonb,'SQL refuses an AI first reply');
select is(private.instagram_comment_first_node('{"nodes":[{"id":"00000000-0000-4000-8000-000000004211","type":"trigger"},{"id":"00000000-0000-4000-8000-000000004212","type":"tag","config":{}}],"edges":[{"source":"00000000-0000-4000-8000-000000004211","target":"00000000-0000-4000-8000-000000004212","sourceHandle":"default"}]}'),null::jsonb,'SQL refuses CRM before first reply');
select pg_temp.comment_intent(:'conn','deleted42','955') as di \gset
select (select event_id from public.instagram_send_intents where id=:'di') as dev \gset
select tests.authenticate_as(:'ua');
select public.delete_automation(:'auto');
select tests.clear_authentication();
select is(public.claim_instagram_send(:'di'),'null'::jsonb,'deleting automation prevents pending private send');
select is(public.prepare_instagram_comment_send(:'dev'),'null'::jsonb,'deleted automation never prepares frozen work');
select is((select state from public.instagram_events where id=:'dev'),'ignored','deletion cancels pending verification');
select is((select state from public.instagram_send_intents where id=:'di'),'failed','deletion cancels pending private send');
select * from finish();
rollback;
