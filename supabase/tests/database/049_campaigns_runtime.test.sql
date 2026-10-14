begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select tests.create_user('owner49@t.test','Owner49') as ua \gset
select tests.create_user('viewer49@t.test','Viewer49') as uv \gset
select tests.create_user('owner49b@t.test','Owner49B') as ub \gset
select tests.create_org(:'ua','Org49') as oa \gset
select tests.create_org(:'ub','Org49B') as ob \gset
select tests.add_member(:'oa',:'uv','viewer');
create function pg_temp.n(p text) returns uuid language sql immutable as $$ select md5('campaign49:' || p)::uuid $$;
insert into public.channels(id,organization_id,type,name,status) values
 (pg_temp.n('ig'),:'oa','instagram','IG49','active'),
 (pg_temp.n('sim'),:'oa','simulator','Sim49','active'),
 (pg_temp.n('igb'),:'ob','instagram','IG49B','active');
insert into public.contacts(id,organization_id,name,lead_score,last_interaction_at)
 select pg_temp.n('k'||i),:'oa','Contato'||i,case when i=1 then 90 else 30 end,
 case when i=1 then now()-interval '1 day' when i=2 then now()-interval '40 days' else null end
 from generate_series(1,6) i;
insert into public.contacts(id,organization_id,name) values(pg_temp.n('kb'),:'ob','Outro');
insert into public.conversations(id,organization_id,contact_id,channel_id,created_at)
 select pg_temp.n('c'||i),:'oa',pg_temp.n('k'||i),pg_temp.n('ig'),now()-interval '1 day'
 from generate_series(1,5) i;
insert into public.conversations(id,organization_id,contact_id,channel_id,created_at) values
 (pg_temp.n('cs1'),:'oa',pg_temp.n('k1'),pg_temp.n('sim'),now()),
 (pg_temp.n('cs3'),:'oa',pg_temp.n('k3'),pg_temp.n('sim'),now());
-- Only inbound contact messages open the window; notes, outbound and old inbound do not.
insert into public.messages(organization_id,conversation_id,channel_id,direction,sender_type,content,is_internal_note,created_at)
 values (:'oa',pg_temp.n('c1'),pg_temp.n('ig'),'inbound','contact','Oi',false,now()-interval '1 hour'),
 (:'oa',pg_temp.n('c2'),pg_temp.n('ig'),'inbound','contact','Antiga',false,now()-interval '25 hours'),
 (:'oa',pg_temp.n('c2'),pg_temp.n('ig'),'outbound','human','Resposta',false,now()),
 (:'oa',pg_temp.n('c3'),pg_temp.n('ig'),'inbound','system','Nota',true,now()),
 (:'oa',pg_temp.n('c4'),pg_temp.n('ig'),'inbound','contact','Oi',false,now()-interval '2 hours'),
 (:'oa',pg_temp.n('c5'),pg_temp.n('ig'),'inbound','contact','Oi',false,now()-interval '3 hours');
insert into public.tags(id,organization_id,name) values
 (pg_temp.n('t1'),:'oa','T1'),(pg_temp.n('t2'),:'oa','T2'),(pg_temp.n('tb'),:'ob','TB');
insert into public.contact_tags(organization_id,contact_id,tag_id) values
 (:'oa',pg_temp.n('k1'),pg_temp.n('t1')),(:'oa',pg_temp.n('k1'),pg_temp.n('t2')),
 (:'oa',pg_temp.n('k2'),pg_temp.n('t1'));
insert into public.pipelines(id,organization_id,name) values(pg_temp.n('p'),:'oa','P'),(pg_temp.n('pb'),:'ob','PB');
insert into public.pipeline_stages(id,organization_id,pipeline_id,name,position) values
 (pg_temp.n('stage'),:'oa',pg_temp.n('p'),'Etapa',1),(pg_temp.n('stageb'),:'ob',pg_temp.n('pb'),'Outra',1);
insert into public.deals(organization_id,pipeline_id,stage_id,contact_id,title) values
 (:'oa',pg_temp.n('p'),pg_temp.n('stage'),pg_temp.n('k1'),'Negócio');
insert into public.entry_links(id,organization_id,name,channel_id,code) values
 (pg_temp.n('link'),:'oa','Link',pg_temp.n('ig'),'link49'),(pg_temp.n('linkb'),:'ob','Outro',pg_temp.n('igb'),'link49');
insert into public.entry_link_hits(organization_id,link_id,contact_id,conversation_id,external_id)
 values(:'oa',pg_temp.n('link'),pg_temp.n('k1'),pg_temp.n('c1'),'hit49');
create function pg_temp.a(p jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('channelIds',jsonb_build_array(pg_temp.n('ig')),'tagsAll','[]'::jsonb,
 'tagsAny','[]'::jsonb,'tagsNone','[]'::jsonb,'stageIds','[]'::jsonb,'entryLinkIds','[]'::jsonb,
 'minLeadScore',null,'lastInteractionDays',null) || p $$;
create function pg_temp.preview(p jsonb default '{}') returns jsonb language sql as $$
 select public.preview_campaign_audience((select id from public.organizations where name='Org49'),pg_temp.a(p)) $$;
select tests.authenticate_as(:'uv');
-- Missing/wrong predicate in the resolver changes these independently derived totals.
select is(pg_temp.preview(),'{"total":5,"inWindow":3,"outOfWindow":2}'::jsonb,'preview: channel and real 24h window');
select is((pg_temp.preview(jsonb_build_object('tagsAll',jsonb_build_array(pg_temp.n('t1'),pg_temp.n('t2'))))->>'total')::int,1,'tagsAll');
select is((pg_temp.preview(jsonb_build_object('tagsAny',jsonb_build_array(pg_temp.n('t2'))))->>'total')::int,1,'tagsAny');
select is((pg_temp.preview(jsonb_build_object('tagsNone',jsonb_build_array(pg_temp.n('t1'))))->>'total')::int,3,'tagsNone');
select is((pg_temp.preview(jsonb_build_object('stageIds',jsonb_build_array(pg_temp.n('stage'))))->>'total')::int,1,'stage');
select is((pg_temp.preview('{"minLeadScore":80}')->>'total')::int,1,'min score');
select is((pg_temp.preview('{"lastInteractionDays":7}')->>'total')::int,1,'last interaction excludes old/null');
select is((pg_temp.preview(jsonb_build_object('entryLinkIds',jsonb_build_array(pg_temp.n('link'))))->>'total')::int,1,'entry link');
select is((pg_temp.preview(jsonb_build_object('tagsAll',jsonb_build_array(pg_temp.n('t1')),'minLeadScore',80))->>'total')::int,1,'filters combine with AND');
select is(pg_temp.preview(jsonb_build_object('channelIds',jsonb_build_array(pg_temp.n('sim')))),
 '{"total":2,"inWindow":2,"outOfWindow":0}'::jsonb,'simulator always in window');
select is(pg_temp.preview(jsonb_build_object('channelIds',jsonb_build_array(pg_temp.n('ig'),pg_temp.n('sim')))),
 '{"total":5,"inWindow":4,"outOfWindow":1}'::jsonb,'multi-channel unique contacts, available window wins');
select is((pg_temp.preview(jsonb_build_object('tagsAll',jsonb_build_array(pg_temp.n('tb'))))->>'total')::int,0,'foreign required tag never matches');
select is((pg_temp.preview(jsonb_build_object('tagsAny',jsonb_build_array(pg_temp.n('tb'))))->>'total')::int,0,'foreign optional tag never matches');
select is((pg_temp.preview(jsonb_build_object('tagsNone',jsonb_build_array(pg_temp.n('tb'))))->>'total')::int,5,'foreign excluded tag does not filter local contacts');
select is((pg_temp.preview(jsonb_build_object('stageIds',jsonb_build_array(pg_temp.n('stageb'))))->>'total')::int,0,'foreign stage never matches');
select is((pg_temp.preview(jsonb_build_object('entryLinkIds',jsonb_build_array(pg_temp.n('linkb'))))->>'total')::int,0,'foreign link never matches');
select throws_ok(format('select public.preview_campaign_audience(%L,%L)',:'ob',pg_temp.a()),'P0002',null,'foreign org preview hidden');
select throws_ok(format('select public.preview_campaign_audience(%L,%L)',:'oa','{"channelIds":[]}'),'22023',null,'invalid audience rejected');
select tests.clear_authentication();
insert into public.campaigns(id,organization_id,name,audience,message) select pg_temp.n('camp'||i),:'oa','Camp'||i,pg_temp.a(),'{"text":"Oi"}' from generate_series(1,5) i;
update public.campaigns set audience=pg_temp.a('{"minLeadScore":100}') where id=pg_temp.n('camp3');
update public.campaigns set audience=pg_temp.a(jsonb_build_object('tagsAll',jsonb_build_array(pg_temp.n('t1')),'tagsNone',jsonb_build_array(pg_temp.n('t2')))) where id=pg_temp.n('camp4');
update public.campaigns set audience=pg_temp.a(jsonb_build_object('channelIds',jsonb_build_array(pg_temp.n('ig'),pg_temp.n('sim')))) where id=pg_temp.n('camp5');
select tests.authenticate_as(:'uv');
select throws_ok('select public.schedule_campaign(pg_temp.n(''camp1''),null)','42501',null,'viewer cannot schedule');
select throws_ok('select public.cancel_campaign(pg_temp.n(''camp1''))','42501',null,'viewer cannot cancel');
select tests.authenticate_as(:'ub');
select throws_ok('select public.schedule_campaign(pg_temp.n(''camp1''),null)','P0002',null,'foreign campaign schedule hidden');
select throws_ok('select public.cancel_campaign(pg_temp.n(''camp1''))','P0002',null,'foreign campaign cancel hidden');
select throws_ok('select public.campaign_report(pg_temp.n(''camp1''))','P0002',null,'foreign campaign report hidden');
select tests.authenticate_as(:'ua');
select lives_ok('select public.schedule_campaign(pg_temp.n(''camp1''),null)','schedule now');
select lives_ok('select public.schedule_campaign(pg_temp.n(''camp2''),now()+interval ''1 day'')','schedule future');
select public.schedule_campaign(pg_temp.n('camp3'),null),public.schedule_campaign(pg_temp.n('camp4'),null);
select throws_ok('select public.schedule_campaign(pg_temp.n(''camp1''),null)','22023',null,'cannot schedule twice');
select tests.clear_authentication();
select is((select status from public.campaigns where id=pg_temp.n('camp1')),'scheduled','scheduled state');
select is((select scheduled_at from public.campaigns where id=pg_temp.n('camp1')),now(),'null date = now');
update private.outreach_settings set campaign_rate_per_minute=30;
select private.start_due_campaigns();
select is((select status from public.campaigns where id=pg_temp.n('camp1')),'sending','due starts');
select is((select status from public.campaigns where id=pg_temp.n('camp2')),'scheduled','future not started');
select is((select started_at from public.campaigns where id=pg_temp.n('camp1')),now(),'started timestamp');
select is((select count(*)::int from public.outreach_deliveries where campaign_id=pg_temp.n('camp1')),5,'snapshot includes out of window');
select is((select count(*)::int from public.outreach_deliveries where campaign_id=pg_temp.n('camp1') and status='pending'),3,'snapshot in-window pending');
select is((select count(*)::int from public.outreach_deliveries where campaign_id=pg_temp.n('camp1') and status='skipped' and reason='window_closed'),2,'snapshot out-of-window skipped');
select is((select array_agg(run_after-now() order by run_after) from public.outreach_deliveries where campaign_id=pg_temp.n('camp1') and status='pending'),
 array[interval '0 seconds',interval '2 seconds',interval '4 seconds'],'30/minute pacing, skipped consume no slot');
select is((select status from public.campaigns where id=pg_temp.n('camp3')),'completed','empty campaign completes');
select is((select status from public.campaigns where id=pg_temp.n('camp4')),'completed','all skipped completes');
select is((select finished_at from public.campaigns where id=pg_temp.n('camp4')),now(),'completed timestamp');
select tests.authenticate_as(:'ua');
select public.schedule_campaign(pg_temp.n('camp5'),null);
select tests.clear_authentication();
-- An unrelated future sequence delivery must not reserve the campaign pacing horizon.
insert into public.outreach_deliveries(organization_id,source,contact_id,channel_id,run_after)
 values(:'oa','sequence',pg_temp.n('k1'),pg_temp.n('sim'),now()+interval '30 days');
select private.start_due_campaigns();
select is((select count(*)::int from public.outreach_deliveries where campaign_id=pg_temp.n('camp5')),5,'multi-channel one delivery per contact');
select is((select channel_id from public.outreach_deliveries where campaign_id=pg_temp.n('camp5') and contact_id=pg_temp.n('k3')),pg_temp.n('sim'),'reachable simulator preferred to closed instagram');
select is((select array_agg(run_after-now() order by run_after) from public.outreach_deliveries where campaign_id=pg_temp.n('camp5') and status='pending' and channel_id=pg_temp.n('sim')),
 array[interval '0 seconds',interval '2 seconds'],'pacing partitioned per channel');
select is((select array_agg(run_after-now() order by run_after) from public.outreach_deliveries where campaign_id=pg_temp.n('camp5') and status='pending' and channel_id=pg_temp.n('ig')),
 array[interval '6 seconds',interval '8 seconds'],'overlapping campaigns share channel pacing slots');
select private.start_due_campaigns();
select is((select count(*)::int from public.outreach_deliveries where campaign_id=pg_temp.n('camp1')),5,'RF5: double start no duplicates');
-- Mutating CRM after start cannot alter the captured recipients.
update public.contacts set lead_score=100 where id=pg_temp.n('k6');
select private.start_due_campaigns();
select is((select count(*)::int from public.outreach_deliveries where campaign_id=pg_temp.n('camp3')),0,'snapshot remains fixed');
update public.outreach_deliveries set status='sending',claim_token=pg_temp.n('token'),claimed_until=now()+interval '3 minutes'
 where campaign_id=pg_temp.n('camp1') and contact_id=pg_temp.n('k1');
select tests.authenticate_as(:'ua');
select public.cancel_campaign(pg_temp.n('camp1'));
select public.cancel_campaign(pg_temp.n('camp1'));
select tests.clear_authentication();
select is((select status from public.campaigns where id=pg_temp.n('camp1')),'cancelled','RF4: campaign cancelled');
select is((select count(*)::int from public.outreach_deliveries where campaign_id=pg_temp.n('camp1') and status='cancelled'),2,'RF4: pending cancelled');
select is((select status||':'||(claim_token is not null)::text from public.outreach_deliveries where campaign_id=pg_temp.n('camp1') and contact_id=pg_temp.n('k1')),'sending:true','RF4: sending claim preserved');
update public.outreach_deliveries set status='sent' where campaign_id=pg_temp.n('camp1') and status='sending';
select private.campaign_maybe_complete(pg_temp.n('camp1'));
select is((select status from public.campaigns where id=pg_temp.n('camp1')),'cancelled','RF4: in-flight finishes without uncancelling campaign');
update public.outreach_deliveries set status='failed',reason='provider_error' where campaign_id=pg_temp.n('camp5') and contact_id=pg_temp.n('k4');
update public.outreach_deliveries set status='sent' where campaign_id=pg_temp.n('camp5') and status='pending';
select private.campaign_maybe_complete(pg_temp.n('camp5'));
select is((select status from public.campaigns where id=pg_temp.n('camp5')),'completed','last terminal delivery completes sending campaign');
insert into public.events(organization_id,type,contact_id,actor_type,payload)
 select :'oa','outreach_click',pg_temp.n('k5'),'contact',jsonb_build_object('deliveryId',id,'optionId','cta') from public.outreach_deliveries where campaign_id=pg_temp.n('camp5') and contact_id=pg_temp.n('k5');
-- Forged cross-org event is excluded by both event and delivery organization.
insert into public.events(organization_id,type,actor_type,payload)
 select :'ob','outreach_click','system',jsonb_build_object('deliveryId',id,'optionId','cta') from public.outreach_deliveries where campaign_id=pg_temp.n('camp5') and contact_id=pg_temp.n('k5');
select tests.authenticate_as(:'uv');
select is(public.campaign_report(pg_temp.n('camp1'))->'counts','{"sent":1,"skipped":{"window_closed":2},"failed":{},"cancelled":2}'::jsonb,'report status totals/reasons');
select is(public.campaign_report(pg_temp.n('camp5'))->'counts','{"sent":3,"skipped":{"window_closed":1},"failed":{"provider_error":1},"cancelled":0}'::jsonb,'report failure reasons');
select is(public.campaign_report(pg_temp.n('camp5'))->'clicks','{"cta":1}'::jsonb,'report isolated option clicks');
select is(jsonb_array_length(public.campaign_report(pg_temp.n('camp1'),2,1)->'recipients'),2,'report pagination');
select isnt(public.campaign_report(pg_temp.n('camp1'),1,0)->'recipients'->0->>'id',public.campaign_report(pg_temp.n('camp1'),1,1)->'recipients'->0->>'id','report pages do not overlap');
select ok(not (public.campaign_report(pg_temp.n('camp1'))->'recipients'->0 ? 'claim_token'),'report hides claim credentials');
select throws_ok('select public.campaign_report(pg_temp.n(''camp1''),0,-1)','22023',null,'invalid pagination rejected');
select tests.clear_authentication();
-- A completed send still reserves its last channel slot: consecutive campaigns cannot burst.
update private.outreach_settings set campaign_rate_per_minute=15;
insert into public.campaigns(id,organization_id,name,audience,message)
 values(pg_temp.n('camp6'),:'oa','Rate15',pg_temp.a(jsonb_build_object('channelIds',jsonb_build_array(pg_temp.n('sim')))),'{"text":"Oi"}');
select tests.authenticate_as(:'ua');
select public.schedule_campaign(pg_temp.n('camp6'),null);
select tests.clear_authentication();
select private.start_due_campaigns();
select is((select array_agg(run_after-now() order by run_after) from public.outreach_deliveries where campaign_id=pg_temp.n('camp6')),
 array[interval '6 seconds',interval '10 seconds'],'15/minute config and completed send slot respected');
select private.campaign_maybe_complete(pg_temp.n('camp6'));
select is((select status from public.campaigns where id=pg_temp.n('camp6')),'sending','pending deliveries prevent completion');
select tests.authenticate_as(:'ua');
select public.cancel_campaign(pg_temp.n('camp2'));
select tests.clear_authentication();
select is((select status from public.campaigns where id=pg_temp.n('camp2')),'cancelled','cancel scheduled campaign before snapshot');
select is((select count(*)::int from public.outreach_deliveries where campaign_id=pg_temp.n('camp2')),0,'cancelled schedule never captures audience');
select ok(not has_function_privilege('anon','public.preview_campaign_audience(uuid,jsonb)','execute'),'anon no preview');
select ok(not has_function_privilege('anon','public.schedule_campaign(uuid,timestamptz)','execute'),'anon no schedule');
select ok(not has_function_privilege('authenticated','private.start_due_campaigns()','execute'),'member no worker function');
select ok(not has_function_privilege('authenticated','private.campaign_maybe_complete(uuid)','execute'),'member no completion helper');
select * from finish();
rollback;
