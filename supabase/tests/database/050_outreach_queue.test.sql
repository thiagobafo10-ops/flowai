begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select has_function('public','claim_outreach_deliveries',array['integer'],'outreach claim RPC exists');
select has_function('public','prepare_outreach_delivery',array['uuid','uuid'],'outreach prepare RPC exists');
select has_function('public','complete_outreach_delivery',array['uuid','uuid','jsonb'],'outreach complete RPC exists');
select has_function('public','fail_outreach_delivery',array['uuid','uuid','text','boolean'],'outreach fail RPC exists');
select has_function('public','sweep_outreach_deliveries',array[]::text[],'outreach sweep RPC exists');
select tests.create_user('owner50@t.test','Owner50') as ua \gset
select tests.create_user('owner50b@t.test','Owner50B') as ub \gset
select tests.create_org(:'ua','Org50') as oa \gset
select tests.create_org(:'ub','Org50B') as ob \gset
create function pg_temp.n(p text) returns uuid language sql immutable as $$ select md5('outreach50:'||p)::uuid $$;
insert into public.channels(id,organization_id,type,name,status) values
 (pg_temp.n('sim'),:'oa','simulator','Sim50','active'),(pg_temp.n('ig'),:'oa','instagram','IG50','active');
insert into public.contacts(id,organization_id,name,instagram_id,phone) select pg_temp.n('k'||i),:'oa','Ana Silva','ig50'||i,'phone50'||i from generate_series(1,12) i;
insert into public.conversations(id,organization_id,contact_id,channel_id) select pg_temp.n('c'||i),:'oa',pg_temp.n('k'||i),case when i in (2,4) then pg_temp.n('ig') else pg_temp.n('sim') end from generate_series(1,12) i where i<>3;
insert into public.campaigns(id,organization_id,name,status,message) select pg_temp.n('camp'||i),:'oa','Camp50 '||i,'sending','{"text":"Oi {primeiro_nome}"}' from generate_series(1,12) i;
insert into public.outreach_deliveries(id,organization_id,source,campaign_id,contact_id,channel_id,conversation_id,run_after)
 select pg_temp.n('d'||i),:'oa','campaign',pg_temp.n('camp'||i),pg_temp.n('k'||i),case when i in (2,4) then pg_temp.n('ig') else pg_temp.n('sim') end,case when i<>3 then pg_temp.n('c'||i) end,now()-interval '1 minute' from generate_series(1,12) i;
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,created_at) values(:'oa',pg_temp.n('c2'),pg_temp.n('ig'),'inbound','contact','Oi',now()-interval '1 hour');
create temporary table claims as select (x->>'deliveryId')::uuid id,(x->>'claimToken')::uuid token from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
select is((select count(*)::int from claims),12,'claims due deliveries');
select is(public.claim_outreach_deliveries(50),'[]'::jsonb,'reserved delivery is not claimed twice');
select ok((select bool_and(status='sending' and attempts=1 and claimed_until=now()+interval '3 minutes') from public.outreach_deliveries where id in(select id from claims)),'three minute reservation and attempts');
create function pg_temp.prepare(p int) returns jsonb language sql as $$ select public.prepare_outreach_delivery(pg_temp.n('d'||p),token) from claims where id=pg_temp.n('d'||p) $$;
create function pg_temp.complete(p int,p_result jsonb default '{}') returns jsonb language sql as $$ select public.complete_outreach_delivery(pg_temp.n('d'||p),token,p_result) from claims where id=pg_temp.n('d'||p) $$;
select is(pg_temp.prepare(1)->>'action','send','prepare sends');
select is(pg_temp.prepare(1)#>>'{message,text}','Oi Ana','prepare renders variables');
select is(public.prepare_outreach_delivery(pg_temp.n('d1'),gen_random_uuid()),'{"action":"skip"}'::jsonb,'wrong claim cannot prepare');
select is(pg_temp.complete(1,'{"text":"Override"}')->>'state','sent','simulator send completes');
select is((select content from public.messages where id=(select message_id from public.outreach_deliveries where id=pg_temp.n('d1'))),'Oi Ana','worker cannot override canonical text');
select ok((select sender_type='automation' and status='delivered' and context#>>'{outreach,deliveryId}'=pg_temp.n('d1')::text from public.messages where id=(select message_id from public.outreach_deliveries where id=pg_temp.n('d1'))),'simulator outbound outreach context');
select is(pg_temp.complete(1)->>'state','sent','completion replay stable');
select is((select count(*)::int from public.messages where context#>>'{outreach,deliveryId}'=pg_temp.n('d1')::text),1,'replay writes one message');
select is((select status from public.campaigns where id=pg_temp.n('camp1')),'completed','last terminal delivery completes campaign');
select is(pg_temp.complete(2,'{"instagram":{"text":"Oi Ana"}}')->>'state','sent','Instagram queues intent');
select is((select message_payload from public.instagram_send_intents where id=(select intent_id from public.outreach_deliveries where id=pg_temp.n('d2'))),'{"text":"Oi Ana"}'::jsonb,'Instagram body retained');
select is(jsonb_array_length(pg_temp.complete(2)->'intentIds'),1,'Instagram replay returns same intent');
select is(pg_temp.complete(3)->>'state','skipped','missing conversation skipped');
select is((select reason from public.outreach_deliveries where id=pg_temp.n('d3')),'no_conversation','missing conversation reason');
select is(pg_temp.complete(4)->>'state','skipped','Instagram closed window skipped');
select is((select reason from public.outreach_deliveries where id=pg_temp.n('d4')),'window_closed','closed window reason');
update public.campaigns set status='cancelled' where id=pg_temp.n('camp5');
select is(pg_temp.complete(5)->>'state','cancelled','cancelled campaign checked after prepare');
select is((select count(*)::int from public.messages where context#>>'{outreach,deliveryId}'=pg_temp.n('d5')::text),0,'cancelled in-flight creates no send');
select public.fail_outreach_delivery(pg_temp.n('d6'),(select token from claims where id=pg_temp.n('d6')),'network_error',true);
select ok((select status='pending' and run_after=now()+interval '10 seconds' and claim_token is null from public.outreach_deliveries where id=pg_temp.n('d6')),'first failure retry in ten seconds');
update public.outreach_deliveries set status='sending',attempts=2,claim_token=pg_temp.n('t6'),claimed_until=now()+interval '3 minutes' where id=pg_temp.n('d6');
select public.fail_outreach_delivery(pg_temp.n('d6'),pg_temp.n('t6'),'network_error',true);
select ok((select status='pending' and run_after=now()+interval '30 seconds' from public.outreach_deliveries where id=pg_temp.n('d6')),'second failure retry in thirty seconds');
update public.outreach_deliveries set status='sending',attempts=3,claim_token=pg_temp.n('t6'),claimed_until=now()+interval '3 minutes' where id=pg_temp.n('d6');
select public.fail_outreach_delivery(pg_temp.n('d6'),pg_temp.n('t6'),'network_error',true);
select is((select status from public.outreach_deliveries where id=pg_temp.n('d6')),'failed','third failure terminal');
update public.outreach_deliveries set claimed_until=now()-interval '1 second' where id=pg_temp.n('d7');
select is(pg_temp.complete(7)->>'state','sending','expired token cannot send');
select public.sweep_outreach_deliveries();
select ok((select status='pending' and reason='reservation_expired' and claim_token is null from public.outreach_deliveries where id=pg_temp.n('d7')),'sweep retries expired reservation');
select tests.authenticate_as(:'ua');
select throws_ok('select public.claim_outreach_deliveries(1)','42501',null,'authenticated cannot claim');
select throws_ok('select public.prepare_outreach_delivery(gen_random_uuid(),gen_random_uuid())','42501',null,'authenticated cannot prepare');
select throws_ok('select public.complete_outreach_delivery(gen_random_uuid(),gen_random_uuid(),''{}'')','42501',null,'authenticated cannot complete');
select throws_ok('select public.fail_outreach_delivery(gen_random_uuid(),gen_random_uuid(),''failed'',false)','42501',null,'authenticated cannot fail');
select throws_ok('select public.sweep_outreach_deliveries()','42501',null,'authenticated cannot sweep');
select tests.clear_authentication();
-- Real active automation drives busy postponements and button routing.
insert into public.automations(id,organization_id,name,trigger_type,status,current_version,activated_at) values
 (pg_temp.n('auto'),:'oa','Target50','message_received','active',1,now()),
 (pg_temp.n('autob'),:'ob','Foreign50','message_received','active',1,now());
insert into public.automation_versions(organization_id,automation_id,version,trigger_type,trigger_config,graph)
 select organization_id,id,1,'message_received','{}',jsonb_build_object('nodes',jsonb_build_array(jsonb_build_object('id',pg_temp.n('trigger'),'type','trigger','config','{}'::jsonb)),'edges','[]'::jsonb)
 from public.automations where id in(pg_temp.n('auto'),pg_temp.n('autob'));
insert into public.events(id,organization_id,type,actor_type) values(pg_temp.n('busy_event'),:'oa','automation_trigger','system');
insert into public.automation_runs(organization_id,automation_id,trigger_event_id,conversation_id,contact_id,status,current_node_id,version)
 values(:'oa',pg_temp.n('auto'),pg_temp.n('busy_event'),pg_temp.n('c8'),pg_temp.n('k8'),'pending',pg_temp.n('trigger'),1);
select is(pg_temp.complete(8)->>'state','pending','busy conversation postpones');
select ok((select postponements=1 and run_after=now()+interval '10 minutes' and attempts=0 from public.outreach_deliveries where id=pg_temp.n('d8')),'busy increments postponements without consuming failure budget');
do $$ begin for i in 2..6 loop
 update public.outreach_deliveries set status='sending',claim_token=(select token from claims where id=pg_temp.n('d8')),claimed_until=now()+interval '3 minutes',attempts=attempts+1 where id=pg_temp.n('d8');
 perform pg_temp.complete(8);
 end loop; end $$;
select is((select postponements from public.outreach_deliveries where id=pg_temp.n('d8')),6,'six postponements permitted');
update public.outreach_deliveries set status='sending',claim_token=(select token from claims where id=pg_temp.n('d8')),claimed_until=now()+interval '3 minutes' where id=pg_temp.n('d8');
select is(pg_temp.complete(8)->>'state','skipped','seventh busy encounter skipped');
select is((select reason from public.outreach_deliveries where id=pg_temp.n('d8')),'conversation_busy','busy terminal reason');
insert into public.sequences(id,organization_id,name,status,settings) values(pg_temp.n('seq'),:'oa','Seq50','active',jsonb_build_object('channelIds',jsonb_build_array(pg_temp.n('sim')),'exitOnReply',true));
insert into public.sequence_steps(id,organization_id,sequence_id,position,delay_minutes,message) values
 (pg_temp.n('step1'),:'oa',pg_temp.n('seq'),1,1,'{"text":"Primeiro"}'),(pg_temp.n('step2'),:'oa',pg_temp.n('seq'),2,1,'{"text":"Segundo"}');
select private.sequence_enroll(pg_temp.n('seq'),pg_temp.n('k9'),'system') as en \gset
update public.outreach_deliveries set run_after=now() where enrollment_id=:'en';
insert into claims select (x->>'deliveryId')::uuid,(x->>'claimToken')::uuid from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
select is((public.complete_outreach_delivery((select id from public.outreach_deliveries where enrollment_id=:'en' and step_id=pg_temp.n('step1')),(select token from claims where id=(select id from public.outreach_deliveries where enrollment_id=:'en' and step_id=pg_temp.n('step1'))),'{}'))->>'state','sent','sequence first step sent');
select is((select count(*)::int from public.outreach_deliveries where enrollment_id=:'en' and step_id=pg_temp.n('step2') and status='pending'),1,'sequence next step scheduled');
update public.outreach_deliveries set run_after=now() where enrollment_id=:'en' and status='pending';
insert into claims select (x->>'deliveryId')::uuid,(x->>'claimToken')::uuid from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
select public.complete_outreach_delivery(d.id,c.token,'{}') from public.outreach_deliveries d join claims c on c.id=d.id where d.enrollment_id=:'en' and d.step_id=pg_temp.n('step2');
select is((select status from public.sequence_enrollments where id=:'en'),'completed','last sequence step completes enrollment');
-- Canonical signed options and untrusted payloads use the same ingress as fa1.
update public.campaigns set message=jsonb_build_object('text','Escolha','buttons',jsonb_build_array(jsonb_build_object('id','go','title','Abrir','kind','automation','automationId',pg_temp.n('auto')))) where id=pg_temp.n('camp10');
select is(pg_temp.prepare(10)#>>'{payloads,go}',private.outreach_payload(pg_temp.n('d10'),'go'),'prepare signs buttons');
select pg_temp.complete(10);
select private.outreach_payload(pg_temp.n('d10'),'go') as payload \gset
select is(private.automation_click_kind(:'oa',pg_temp.n('k10'),pg_temp.n('c10'),:'payload'),'valid','fd1 valid classification');
select is(private.automation_click_kind(:'ob',pg_temp.n('k10'),pg_temp.n('c10'),:'payload'),'forged','cross organization signature discarded');
select is(private.automation_click_kind(:'oa',pg_temp.n('k11'),pg_temp.n('c11'),:'payload'),'forged','cross contact signature discarded');
select is(private.ingest_inbound_core(:'oa',pg_temp.n('sim'),'simulator','forged50','phone5010',null,'Abrir',now(),jsonb_build_object('payload',:'payload'||'0'),pg_temp.n('k10')),null,'forged ingest discarded');
select private.ingest_inbound_core(:'oa',pg_temp.n('sim'),'simulator','click50','phone5010',null,'Abrir',now(),jsonb_build_object('payload',:'payload'),pg_temp.n('k10')) as clicked \gset
select is((select count(*)::int from public.events where type='outreach_click' and payload->>'deliveryId'=pg_temp.n('d10')::text and payload->>'optionId'='go'),1,'fd1 records exact outreach click');
select is((select count(*)::int from public.automation_runs where conversation_id=pg_temp.n('c10') and automation_id=pg_temp.n('auto')),1,'fd1 starts targeted automation');
select private.ingest_inbound_core(:'oa',pg_temp.n('sim'),'simulator','click50','phone5010',null,'Abrir',now(),jsonb_build_object('payload',:'payload'),pg_temp.n('k10'));
select is((select count(*)::int from public.events where type='outreach_click' and payload->>'deliveryId'=pg_temp.n('d10')::text),1,'ingest replay counts one click');
select private.ingest_inbound_core(:'oa',pg_temp.n('sim'),'simulator','click50busy','phone5010',null,'Abrir',now(),jsonb_build_object('payload',:'payload'),pg_temp.n('k10'));
select is((select count(*)::int from public.automation_runs where conversation_id=pg_temp.n('c10') and automation_id=pg_temp.n('auto')),1,'busy click cannot start second automation');
-- A genuine stale click stays text and cannot end an exitOnReply enrollment.
select private.sequence_enroll(pg_temp.n('seq'),pg_temp.n('k10'),'system') as enclick \gset
update public.automations set status='paused' where id=pg_temp.n('auto');
select is(private.automation_click_kind(:'oa',pg_temp.n('k10'),pg_temp.n('c10'),:'payload'),'stale','paused target becomes genuine stale text');
select private.ingest_inbound_core(:'oa',pg_temp.n('sim'),'simulator','stale50','phone5010',null,'Abrir',now(),jsonb_build_object('payload',:'payload'),pg_temp.n('k10')) as stale \gset
select ok((select not(context?'payload') and context->>'staleClick'='true' from public.messages where external_id='stale50'),'stale fd1 ingested as text');
select is((select status from public.sequence_enrollments where id=:'enclick'),'active','genuine stale fd1 exempt from exitOnReply');
update public.campaigns set message=jsonb_build_object('text','Escolha','quickReplies',jsonb_build_array(jsonb_build_object('id','foreign','title','Outro','automationId',pg_temp.n('autob')))) where id=pg_temp.n('camp11');
select pg_temp.complete(11);
select is(private.automation_click_kind(:'oa',pg_temp.n('k11'),pg_temp.n('c11'),private.outreach_payload(pg_temp.n('d11'),'foreign')),'stale','foreign automation reference never executes');
-- Dispatcher local configuration and pg_net request stay inside the rolled-back transaction.
select public.configure_automation_worker('http://localhost:54321',repeat('s',24),repeat('w',32));
update public.campaigns set status='scheduled',scheduled_at=now(),audience=jsonb_build_object('channelIds',jsonb_build_array(pg_temp.n('sim'))) where id=pg_temp.n('camp12');
delete from public.outreach_deliveries where id=pg_temp.n('d12');
select public.dispatch_automation_worker();
select is((select status from public.campaigns where id=pg_temp.n('camp12')),'sending','dispatch starts due campaign');
select ok(exists(select 1 from net.http_request_queue where url='http://localhost:54321/functions/v1/automation-worker'),'dispatch queues worker for due outreach');
select tests.authenticate_as(:'ua');
select lives_ok('select public.click_automation_button((select message_id from public.outreach_deliveries where id=pg_temp.n(''d10'')),''go'')','Simulator supports genuine stale fd1');
select tests.authenticate_as(:'ub');
select throws_ok('select public.click_automation_button((select message_id from public.outreach_deliveries where id=pg_temp.n(''d10'')),''go'')','42501',null,'Simulator fd1 foreign org forbidden');
select tests.clear_authentication();
-- Recheck canonical provider buttons, including payloads, after render.
insert into public.campaigns(id,organization_id,name,status,message) values
 (pg_temp.n('provider'),:'oa','Provider50','sending',jsonb_build_object('text','Escolha','buttons',jsonb_build_array(jsonb_build_object('id','go','title','Abrir','kind','automation','automationId',pg_temp.n('auto'))))),
 (pg_temp.n('nullarrays'),:'oa','Null50','sending','{"text":"Texto","buttons":null,"quickReplies":null}');
insert into public.outreach_deliveries(id,organization_id,source,campaign_id,contact_id,channel_id,conversation_id)
 values(pg_temp.n('providerd'),:'oa','campaign',pg_temp.n('provider'),pg_temp.n('k2'),pg_temp.n('ig'),pg_temp.n('c2')),
 (pg_temp.n('nulld'),:'oa','campaign',pg_temp.n('nullarrays'),pg_temp.n('k1'),pg_temp.n('sim'),pg_temp.n('c1'));
insert into claims select (x->>'deliveryId')::uuid,(x->>'claimToken')::uuid from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
select throws_ok('select public.complete_outreach_delivery(pg_temp.n(''providerd''),(select token from claims where id=pg_temp.n(''providerd'')),''{"instagram":{"text":"Escolha","quick_replies":[{"content_type":"text","title":"Abrir","payload":"forged"}]}}'')','22023',null,'worker cannot forge provider buttons');
select lives_ok('select public.prepare_outreach_delivery(pg_temp.n(''nulld''),(select token from claims where id=pg_temp.n(''nulld'')))','optional null arrays supported');
-- Terminal cancellation and edited/removed sequence steps never send.
select private.sequence_enroll(pg_temp.n('seq'),pg_temp.n('k12'),'system') as edit_en \gset
update public.outreach_deliveries set run_after=now() where enrollment_id=:'edit_en';
insert into claims select (x->>'deliveryId')::uuid,(x->>'claimToken')::uuid from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
update public.sequence_steps set removed_at=now(),position=null where id=pg_temp.n('step1');
select public.complete_outreach_delivery(d.id,c.token,'{}') from public.outreach_deliveries d join claims c on c.id=d.id where d.enrollment_id=:'edit_en' and d.step_id=pg_temp.n('step1');
select ok(exists(select 1 from public.outreach_deliveries where enrollment_id=:'edit_en' and step_id=pg_temp.n('step2') and status='pending'),'removed step advances without sending');
update public.outreach_deliveries set step_id=null where enrollment_id=:'edit_en' and step_id=pg_temp.n('step2');
update public.outreach_deliveries set run_after=now() where enrollment_id=:'edit_en' and status='pending';
insert into claims select (x->>'deliveryId')::uuid,(x->>'claimToken')::uuid from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
select public.complete_outreach_delivery(d.id,c.token,'{}') from public.outreach_deliveries d join claims c on c.id=d.id where d.enrollment_id=:'edit_en' and d.step_id is null;
select is((select count(*)::int from public.messages where context#>>'{outreach,deliveryId}' in(select id::text from public.outreach_deliveries where enrollment_id=:'edit_en')),0,'null step skipped');
update public.outreach_deliveries set contact_id=null where id=pg_temp.n('d9');
select is(pg_temp.complete(9)->>'state','cancelled','null contact cancels delivery');
select throws_ok('select public.fail_outreach_delivery(pg_temp.n(''d7''),gen_random_uuid(),''Error text!'',true)','22023',null,'failure reason rejects message/log text');
-- Limits are evaluated on expanded text and on button templates at the actual send.
insert into public.campaigns(id,organization_id,name,status,message) values
 (pg_temp.n('long'),:'oa','Long50','sending',jsonb_build_object('text',repeat('é',495)||'{nome}')),
 (pg_temp.n('buttonlong'),:'oa','ButtonLong50','sending',jsonb_build_object('text',repeat('a',641),'buttons',jsonb_build_array(jsonb_build_object('id','url','title','Site','kind','url','url','https://example.test'))));
insert into public.outreach_deliveries(id,organization_id,source,campaign_id,contact_id,channel_id,conversation_id) values
 (pg_temp.n('longd'),:'oa','campaign',pg_temp.n('long'),pg_temp.n('k2'),pg_temp.n('ig'),pg_temp.n('c2')),
 (pg_temp.n('buttonlongd'),:'oa','campaign',pg_temp.n('buttonlong'),pg_temp.n('k2'),pg_temp.n('ig'),pg_temp.n('c2'));
update public.contacts set name='Ana Silva Pessoa' where id=pg_temp.n('k2');
insert into claims select (x->>'deliveryId')::uuid,(x->>'claimToken')::uuid from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
select public.complete_outreach_delivery(d.id,c.token,'{}') from public.outreach_deliveries d join claims c on c.id=d.id where d.id in(pg_temp.n('longd'),pg_temp.n('buttonlongd'));
select ok((select bool_and(status='skipped' and reason='reply_too_long') from public.outreach_deliveries where id in(pg_temp.n('longd'),pg_temp.n('buttonlongd'))),'rendered bytes and 640 button text limit enforced');
select is(private.automation_click_kind(:'oa',pg_temp.n('k10'),pg_temp.n('c10'),private.outreach_payload(pg_temp.n('d10'),'missing')),'stale','authentic removed option falls back to text');
-- Paused sequence is rechecked under its parent locks after prepare.
select private.sequence_enroll(pg_temp.n('seq'),pg_temp.n('k11'),'system') as pause_en \gset
update public.outreach_deliveries set run_after=now() where enrollment_id=:'pause_en';
insert into claims select (x->>'deliveryId')::uuid,(x->>'claimToken')::uuid from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
select tests.authenticate_as(:'ua');
select public.set_sequence_status(pg_temp.n('seq'),'paused');
select tests.clear_authentication();
select public.complete_outreach_delivery(d.id,c.token,'{}') from public.outreach_deliveries d join claims c on c.id=d.id where d.enrollment_id=:'pause_en';
select is((select count(*)::int from public.messages where context#>>'{outreach,deliveryId}' in(select id::text from public.outreach_deliveries where enrollment_id=:'pause_en')),0,'paused in-flight sends nothing');
-- Valid Instagram fd1 travels through both Instagram preclassification and shared core ingress.
select public.save_instagram_connection(:'ua',:'oa','{"appId":"150","appSecret":"fixture","accessToken":"fixture","accountId":"78950","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn,(:'saved'::jsonb->>'channelId') as igclick \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
update public.automations set status='active' where id=pg_temp.n('auto');
insert into public.conversations(id,organization_id,contact_id,channel_id) values(pg_temp.n('igclickconv'),:'oa',pg_temp.n('k1'),:'igclick');
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content) values(:'oa',pg_temp.n('igclickconv'),:'igclick','inbound','contact','Oi');
-- Cancel any keyword/message_received fixture run to isolate the button start.
update public.automation_runs set status='cancelled' where conversation_id=pg_temp.n('igclickconv');
insert into public.campaigns(id,organization_id,name,status,message) values(pg_temp.n('igclickcamp'),:'oa','Click IG50','sending',jsonb_build_object('text','Escolha','quickReplies',jsonb_build_array(jsonb_build_object('id','go','title','Abrir','automationId',pg_temp.n('auto')))));
insert into public.outreach_deliveries(id,organization_id,source,campaign_id,contact_id,channel_id,conversation_id) values(pg_temp.n('igclickd'),:'oa','campaign',pg_temp.n('igclickcamp'),pg_temp.n('k1'),:'igclick',pg_temp.n('igclickconv'));
insert into claims select (x->>'deliveryId')::uuid,(x->>'claimToken')::uuid from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
select public.complete_outreach_delivery(d.id,c.token,jsonb_build_object('instagram',jsonb_build_object('text','Escolha','quick_replies',jsonb_build_array(jsonb_build_object('content_type','text','title','Abrir','payload',private.outreach_payload(d.id,'go')))))) from public.outreach_deliveries d join claims c on c.id=d.id where d.id=pg_temp.n('igclickd');
select is((public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','externalId','igclick50','accountId','78950','senderExternalId','ig501','title','Abrir','occurredAt',now(),'payload',private.outreach_payload(pg_temp.n('igclickd'),'go'))))->>'state','done','Instagram fd1 accepted');
select is((select count(*)::int from public.events where type='outreach_click' and payload->>'deliveryId'=pg_temp.n('igclickd')::text),1,'Instagram counts outreach click once');
select is((select count(*)::int from public.events where type='button_clicked' and payload->>'deliveryId'=pg_temp.n('igclickd')::text),0,'fd1 does not create fa1 click event');
select is((public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','externalId','igforged50','accountId','78950','senderExternalId','ig501','title','Abrir','occurredAt',now(),'payload',private.outreach_payload(pg_temp.n('igclickd'),'go')||'0')))->>'state','ignored','Instagram forged fd1 discarded');
update public.automations set status='paused' where id=pg_temp.n('auto');
select is((public.ingest_instagram_event(:'conn',jsonb_build_object('kind','button','externalId','igstale50','accountId','78950','senderExternalId','ig501','title','Abrir','occurredAt',now(),'payload',private.outreach_payload(pg_temp.n('igclickd'),'go'))))->>'state','done','Instagram genuine stale fd1 becomes text');
select ok((select context->>'outreachClick'='true' and context->>'staleClick'='true' and not(context?'payload') from public.messages where external_id='igstale50'),'Instagram stale retains fd1 exit exemption');
update public.automations set status='active' where id=pg_temp.n('auto');
insert into public.sequences(id,organization_id,name,status,settings) values(pg_temp.n('seqopt'),:'oa','Options50','active',jsonb_build_object('channelIds',jsonb_build_array(pg_temp.n('sim')),'exitOnReply',true));
insert into public.sequence_steps(id,organization_id,sequence_id,position,delay_minutes,message) values
 (pg_temp.n('optstep1'),:'oa',pg_temp.n('seqopt'),1,1,jsonb_build_object('text','Escolha','buttons',jsonb_build_array(jsonb_build_object('id','go','title','Abrir','kind','automation','automationId',pg_temp.n('auto'))))),
 (pg_temp.n('optstep2'),:'oa',pg_temp.n('seqopt'),2,1,'{"text":"Depois"}');
select private.sequence_enroll(pg_temp.n('seqopt'),pg_temp.n('k4'),'system') as opten \gset
update public.outreach_deliveries set channel_id=pg_temp.n('sim'),conversation_id=null,run_after=now() where enrollment_id=:'opten';
insert into public.conversations(id,organization_id,contact_id,channel_id) values(pg_temp.n('optconv'),:'oa',pg_temp.n('k4'),pg_temp.n('sim'));
insert into claims select (x->>'deliveryId')::uuid,(x->>'claimToken')::uuid from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
select d.id as optd,c.token as opttoken from public.outreach_deliveries d join claims c on c.id=d.id where d.enrollment_id=:'opten' \gset
select public.complete_outreach_delivery(:'optd',:'opttoken','{}');
select private.ingest_inbound_core(:'oa',pg_temp.n('sim'),'simulator','activeopt50','phone504',null,'Abrir',now(),jsonb_build_object('payload',private.outreach_payload(:'optd','go')),pg_temp.n('k4'));
select is((select status from public.sequence_enrollments where id=:'opten'),'active','valid fd1 exempt from exitOnReply');
update public.sequence_steps set message='{"text":"Sem opção"}' where id=pg_temp.n('optstep1');
select is(private.automation_click_kind(:'oa',pg_temp.n('k4'),pg_temp.n('optconv'),private.outreach_payload(:'optd','go')),'stale','removed live sequence option becomes text');
select private.ingest_inbound_core(:'oa',pg_temp.n('sim'),'simulator','fakeflag50','phone504',null,'Resposta',now(),'{"outreachClick":true}',pg_temp.n('k4'));
select is((select status from public.sequence_enrollments where id=:'opten'),'exited','unverified outreach flag cannot bypass exitOnReply');
-- Claim -> pause -> guard -> resume must retain the same unsent step and enrollment.
insert into public.sequences(id,organization_id,name,status,settings) values(pg_temp.n('pauseguard'),:'oa','Pause guard50','active',jsonb_build_object('channelIds',jsonb_build_array(pg_temp.n('sim'))));
insert into public.sequence_steps(id,organization_id,sequence_id,position,delay_minutes,message) values
 (pg_temp.n('pauseguard1'),:'oa',pg_temp.n('pauseguard'),1,1,'{"text":"Primeiro reservado"}'),
 (pg_temp.n('pauseguard2'),:'oa',pg_temp.n('pauseguard'),2,1,'{"text":"Segundo reservado"}');
create temporary table pause_cases as select i,private.sequence_enroll(pg_temp.n('pauseguard'),pg_temp.n('k'||i),'system') en from generate_series(5,8) i;
update public.outreach_deliveries set run_after=now() where enrollment_id in(select en from pause_cases);
insert into claims select (x->>'deliveryId')::uuid,(x->>'claimToken')::uuid from jsonb_array_elements(public.claim_outreach_deliveries(50)) x;
alter table pause_cases add column delivery uuid;
update pause_cases p set delivery=(select id from public.outreach_deliveries where enrollment_id=p.en and step_id=pg_temp.n('pauseguard1'));
select tests.authenticate_as(:'ua');
select public.set_sequence_status(pg_temp.n('pauseguard'),'paused');
select tests.clear_authentication();
select is((public.prepare_outreach_delivery(p.delivery,c.token))->>'action','skip','paused claimed prepare skips') from pause_cases p join claims c on c.id=p.delivery where p.i=5;
select is((public.complete_outreach_delivery(p.delivery,c.token,'{}'))->>'state','cancelled','paused claimed complete cancels') from pause_cases p join claims c on c.id=p.delivery where p.i=6;
select public.fail_outreach_delivery(p.delivery,c.token,'network_error',true) from pause_cases p join claims c on c.id=p.delivery where p.i=7;
update public.outreach_deliveries set claimed_until=now()-interval '1 second',attempts=3 where id=(select delivery from pause_cases where i=8);
select public.sweep_outreach_deliveries();
select ok((select bool_and(d.status='cancelled' and d.reason='paused' and e.status='active' and e.next_send_at is null) from pause_cases p join public.outreach_deliveries d on d.id=p.delivery join public.sequence_enrollments e on e.id=p.en),'all four paused guards preserve reusable paused reason and active enrollment');
select tests.authenticate_as(:'ua');
select public.set_sequence_status(pg_temp.n('pauseguard'),'active');
select tests.clear_authentication();
select ok((select bool_and(d.status='pending' and d.step_id=pg_temp.n('pauseguard1') and d.run_after=now()+interval '1 minute' and d.attempts=0 and d.claim_token is null) from pause_cases p join public.outreach_deliveries d on d.id=p.delivery),'resume reuses same delivery and same unsent first step with fresh delay');
select is((select count(*)::int from public.outreach_deliveries where enrollment_id in(select en from pause_cases) and step_id=pg_temp.n('pauseguard2')),0,'pause guards never advance to second step');
select is((select count(*)::int from public.messages where context#>>'{outreach,deliveryId}' in(select delivery::text from pause_cases)),0,'pause guards never send');
select is((public.complete_outreach_delivery(p.delivery,c.token,'{}'))->>'state','pending','old token replay after resume cannot mutate delivery') from pause_cases p join claims c on c.id=p.delivery where p.i=6;
select is((public.prepare_outreach_delivery(p.delivery,c.token))->>'action','skip','old prepare token after resume skipped') from pause_cases p join claims c on c.id=p.delivery where p.i=5;
select * from finish();
rollback;
