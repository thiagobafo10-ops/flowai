begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Catch RPC errors so the original broken function produces assertions, not an
-- aborted fixture transaction. The helper calls the actual invoker/RLS RPC.
create function pg_temp.analytics_result(p_org uuid, p_days int, p_channel uuid default null)
returns jsonb language plpgsql as $$
begin
  return public.analytics_metrics(p_org, p_days, p_channel);
exception when others then
  return jsonb_build_object('_error', SQLSTATE, '_message', SQLERRM);
end;
$$;

select tests.create_user('analytics-owner@t.test') as ua \gset
select tests.create_user('analytics-other@t.test') as ub \gset
select tests.create_user('analytics-empty@t.test') as ue \gset
select tests.create_user('analytics-viewer@t.test') as uv \gset
select tests.authenticate_as(:'ua');
select public.create_organization_with_owner('Analytics A') as org \gset
select tests.authenticate_as(:'ub');
select public.create_organization_with_owner('Analytics B') as orgb \gset
select tests.authenticate_as(:'ue');
select public.create_organization_with_owner('Analytics Empty') as orge \gset
select tests.clear_authentication();
select tests.add_member(:'org', :'uv', 'viewer');
update public.organizations set timezone = 'Asia/Tokyo' where id = :'orge';
select id as pipe from public.pipelines where organization_id = :'org' and is_default \gset
select id as sn from public.pipeline_stages where pipeline_id = :'pipe' and name = 'Novo' \gset
select id as sw from public.pipeline_stages where pipeline_id = :'pipe' and is_won \gset
insert into public.channels (organization_id, type, name) values (:'org', 'instagram', 'AI') returning id as cha \gset
insert into public.channels (organization_id, type, name) values (:'org', 'whatsapp', 'Human') returning id as chh \gset
insert into public.contacts (organization_id, name) values (:'org', 'AI contact') returning id as ca \gset
insert into public.contacts (organization_id, name) values (:'org', 'Human contact') returning id as ch \gset
insert into public.conversations (organization_id, contact_id, channel_id) values (:'org', :'ca', :'cha') returning id as cva \gset
insert into public.conversations (organization_id, contact_id, channel_id) values (:'org', :'ch', :'chh') returning id as cvh \gset
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content) values
  (:'org', :'cva', :'cha', 'inbound', 'contact', 'hello'),
  (:'org', :'cva', :'cha', 'outbound', 'ai', 'reply'),
  (:'org', :'cvh', :'chh', 'inbound', 'contact', 'human please');
update public.conversations set status = 'pending_human' where id = :'cvh';

-- Won today, created before the reporting window. Amount comes from the win
-- snapshot; a later edit must neither add a win nor change historical revenue.
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
values (:'org', :'pipe', :'sn', :'ca', 'Old created / won today', 300) returning id as dold \gset
update public.events set created_at = now() - interval '100 days' where deal_id = :'dold' and type = 'deal_created';
update public.deals set stage_id = :'sw' where id = :'dold';
update public.deals set value = 999 where id = :'dold';

select tests.authenticate_as(:'ua');
select pg_temp.analytics_result(:'org', 7)::text as mold \gset
select ok(not (:'mold'::jsonb ? '_error'), 'actual analytics RPC executes: no nested aggregation or missing metadata column');
select is(:'mold'::jsonb #> '{crm_section,avg_ticket}', '300'::jsonb, 'old-created deal won today contributes its win amount to average');
select is(:'mold'::jsonb #> '{summary,won_deals_value}', '300'::jsonb, 'post-win value edit does not rewrite won revenue');
select is(:'mold'::jsonb #> '{summary,ai_containment_rate}', '100'::jsonb, 'handoff on a human-only conversation does not subtract an AI conversation');
select tests.clear_authentication();

insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
values (:'org', :'pipe', :'sn', :'ch', 'New won', 100) returning id as dnew \gset
update public.deals set stage_id = :'sw' where id = :'dnew';
-- Repeated wins in the same period: select the latest event per deal,
-- deterministic id tie-break if timestamps match. This is not two deals.
insert into public.events (id, organization_id, type, deal_id, contact_id, actor_type, payload, created_at) values
  ('ffffffff-ffff-ffff-ffff-fffffffffff1', :'org', 'deal_won', :'dold', :'ca', 'system', '{"value":500}', now()),
  ('ffffffff-ffff-ffff-ffff-fffffffffff2', :'org', 'deal_won', :'dold', :'ca', 'system', '{"value":300}', now());
-- Won long ago but edited today: excluded from all window win metrics.
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value)
values (:'org', :'pipe', :'sw', :'ca', 'Old win edited today', 700) returning id as dstale \gset
update public.events set created_at = now() - interval '100 days' where deal_id = :'dstale';
update public.deals set title = 'Edited today' where id = :'dstale';
-- Previous local day, and future event: boundaries must be respected.
insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, created_at) values
  (:'org', 'ai_replied', :'cva', :'ca', 'system', (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '1 second'),
  (:'org', 'ai_replied', :'cva', :'ca', 'system', now() + interval '1 day');
-- Another tenant has activity but must never contaminate A.
insert into public.contacts (organization_id, name) values (:'orgb', 'Foreign') returning id as cb \gset
insert into public.channels (organization_id, type, name) values (:'orgb', 'instagram', 'Foreign') returning id as chb \gset
insert into public.conversations (organization_id, contact_id, channel_id) values (:'orgb', :'cb', :'chb') returning id as cvb \gset
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content)
values (:'orgb', :'cvb', :'chb', 'outbound', 'ai', 'foreign');

select tests.authenticate_as(:'ua');
select pg_temp.analytics_result(:'org', 7)::text as m7 \gset
select pg_temp.analytics_result(:'org', 1)::text as m1 \gset
select pg_temp.analytics_result(:'org', 7, :'cha')::text as ma \gset
select pg_temp.analytics_result(:'org', 7, :'chh')::text as mh \gset
select pg_temp.analytics_result(:'org', 7, :'chb')::text as mf \gset
select is(:'m7'::jsonb #> '{crm_section,avg_ticket}', '200'::jsonb, 'mixed old/new wins average 400 / 2 unique deals');
select is(:'m7'::jsonb #> '{summary,won_deals_value}', '400'::jsonb, 'repeat win tie uses latest id once; old win edit is excluded');
select is(:'m7'::jsonb #> '{summary,conversion_rate}', '100'::jsonb, 'conversion remains won among the in-window created cohort');
select is(:'ma'::jsonb #> '{crm_section,avg_ticket}', '300'::jsonb, 'channel filters the same win cohort for sum and average');
select is(:'mh'::jsonb #> '{crm_section,avg_ticket}', '100'::jsonb, 'human channel has only its own win');
select is(:'ma'::jsonb #> '{summary,new_contacts}', '1'::jsonb, 'channel filters contact events through related conversations');
select is(:'ma'::jsonb #> '{summary,new_leads}', '1'::jsonb, 'channel filters lead cohort');
select is(:'m1'::jsonb #> '{ai_section,total_ai_messages}', '1'::jsonb, 'today excludes previous local day and future AI events');
select is(:'m7'::jsonb #> '{ai_section,total_ai_messages}', '2'::jsonb, 'seven days includes yesterday but no future/foreign events');
select is(:'ma'::jsonb #> '{ai_section,total_handoffs}', '0'::jsonb, 'AI channel excludes unrelated human handoffs');
select is(:'mh'::jsonb #> '{ai_section,total_ai_messages}', '0'::jsonb, 'human channel excludes AI messages');
select is(:'mh'::jsonb #> '{summary,ai_containment_rate}', 'null'::jsonb, 'no AI cohort has null containment');
select is(:'mf'::jsonb -> 'has_activity', 'false'::jsonb, 'foreign channel filter has no activity');
select is(:'mf'::jsonb #> '{summary,won_deals_value}', '0'::jsonb, 'foreign channel cannot leak CRM revenue');
select is(:'m7'::jsonb #> '{ai_section,top_handoff_reasons}', '[{"reason":"Solicitação do cliente","count":1}]'::jsonb, 'missing reason uses fallback from actual handoff trigger');
select is((select s->'count' from jsonb_array_elements(:'m7'::jsonb #> '{conversations_section,by_status}') s where s->>'status' = 'waiting'), '1'::jsonb, 'pending_human database status maps to core waiting status');
select is(jsonb_array_length(:'m7'::jsonb #> '{conversations_section,daily_volume}'), 7, 'seven daily points');
select is(jsonb_array_length(:'m7'::jsonb #> '{ai_section,daily_ai_vs_human}'), 7, 'seven AI daily points');
select is((select sum((d->>'won')::int) from jsonb_array_elements(:'m7'::jsonb #> '{crm_section,daily_deals}') d), 2::bigint, 'daily wins count unique deals like revenue cohort');
select throws_ok(format('select public.analytics_metrics(%L, 3)', :'org'), '22023', 'invalid_period', 'unsupported period rejected');
select throws_ok(format('select public.analytics_metrics(%L, null)', :'org'), '22023', 'invalid_period', 'null period rejected');
select throws_ok(format('select public.analytics_metrics(%L, 7)', :'orgb'), '42501', 'not_a_member', 'other tenant denied');
select tests.clear_authentication();

-- Contact-to-channel association uses EXISTS: multiple conversations must not
-- duplicate a lead, deal amount, or stage total.
insert into public.conversations (organization_id, contact_id, channel_id) values (:'org', :'ca', :'cha') returning id as cva2 \gset
insert into public.deals (organization_id, pipeline_id, stage_id, contact_id, title, value) values
  (:'org', :'pipe', :'sn', :'ca', 'AI pipeline', 111),
  (:'org', :'pipe', :'sn', :'ch', 'Human pipeline', 222);
select tests.authenticate_as(:'ua');
select pg_temp.analytics_result(:'org', 7, :'cha')::text as mpipeline \gset
select is(:'mpipeline'::jsonb #> '{summary,total_pipeline_value}', '111'::jsonb, 'multiple channel conversations do not duplicate pipeline value');
select is((select sum((s->>'value')::numeric) from jsonb_array_elements(:'mpipeline'::jsonb #> '{crm_section,funnel}') s), 111::numeric, 'channel filter excludes human deals from funnel');
select is(:'mpipeline'::jsonb #> '{summary,new_leads}', '1'::jsonb, 'multiple conversations do not duplicate channel leads');
select is(:'mpipeline'::jsonb #> '{summary,won_deals_value}', '300'::jsonb, 'multiple conversations do not duplicate channel win revenue');
select tests.clear_authentication();

-- Relevant handoff on the very AI conversation lowers only its own cohort.
update public.conversations set status = 'pending_human' where id = :'cva';
select tests.authenticate_as(:'ua');
select pg_temp.analytics_result(:'org', 7, :'cha')::text as mhand \gset
select is(:'mhand'::jsonb #> '{summary,ai_containment_rate}', '0'::jsonb, 'same AI conversation with in-window handoff is not contained');
select tests.clear_authentication();
insert into public.messages (organization_id, conversation_id, channel_id, direction, sender_type, content)
values (:'org', :'cva2', :'cha', 'outbound', 'ai', 'second AI conversation');
select tests.authenticate_as(:'ua');
select is(pg_temp.analytics_result(:'org', 7, :'cha') #> '{summary,ai_containment_rate}', '50'::jsonb, 'one contained and one handed-off AI conversation produce 50 percent');
select tests.clear_authentication();
update public.events set created_at = now() - interval '100 days' where conversation_id = :'cva' and type = 'handoff';
select tests.authenticate_as(:'ua');
select is(pg_temp.analytics_result(:'org', 7, :'cha') #> '{summary,ai_containment_rate}', '100'::jsonb, 'handoff outside the reporting window does not reduce containment');
select tests.clear_authentication();

-- Seven groups, six tied leaders: sorted by count then reason, limit applied
-- before JSON aggregation. Read reason from events.payload, trim whitespace.
insert into public.events (organization_id, type, conversation_id, contact_id, actor_type, payload)
select :'org', 'handoff', :'cvh', :'ch', 'system', jsonb_build_object('reason', r.reason)
from (values (' A '), ('A'), ('B'), ('B'), ('C'), ('C'), ('D'), ('D'), ('E'), ('E'), ('F'), ('F')) r(reason);
select tests.authenticate_as(:'ua');
select pg_temp.analytics_result(:'org', 7)::text as mreasons \gset
select is(:'mreasons'::jsonb #> '{ai_section,top_handoff_reasons}', '[{"reason":"A","count":2},{"reason":"B","count":2},{"reason":"C","count":2},{"reason":"D","count":2},{"reason":"E","count":2}]'::jsonb, 'payload reasons grouped, trimmed, stable top five');
select tests.clear_authentication();
select tests.authenticate_as(:'uv');
select lives_ok(format('select public.analytics_metrics(%L, 7)', :'org'), 'viewer retains existing membership access');
select tests.clear_authentication();
select tests.authenticate_as(:'ue');
select pg_temp.analytics_result(:'orge', 1)::text as me \gset
select is(:'me'::jsonb -> 'has_activity', 'false'::jsonb, 'empty org has no activity');
select is(:'me'::jsonb #> '{ai_section,top_handoff_reasons}', '[]'::jsonb, 'empty reasons array rather than null');
select is(:'me'::jsonb #> '{crm_section,avg_ticket}', '0'::jsonb, 'no wins has zero average');
select is(:'me'::jsonb #> '{summary,ai_containment_rate}', 'null'::jsonb, 'empty org has null containment');
select is(jsonb_array_length(:'me'::jsonb #> '{conversations_section,daily_volume}'), 1, 'east-of-UTC timezone has exactly one local daily point');
select is(:'me'::jsonb #>> '{crm_section,daily_deals,0,day}', to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD'), 'CRM series starts on organization local day');
select is(jsonb_array_length(pg_temp.analytics_result(:'orge', 30) #> '{ai_section,daily_ai_vs_human}'), 30, '30-day AI series respects local timezone');
select is(jsonb_array_length(pg_temp.analytics_result(:'orge', 90) #> '{crm_section,daily_deals}'), 90, '90-day CRM series respects local timezone');
select tests.clear_authentication();
select throws_ok(format('select public.analytics_metrics(%L, 7)', :'org'), '42501', 'not_a_member', 'unauthenticated caller denied');
select * from finish();
rollback;
