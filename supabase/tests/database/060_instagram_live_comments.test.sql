begin;
-- Comentários em live: origem do gatilho (posts/lives/ambos), uma vez por live e sem resposta pública.
create function pg_temp.save_rule(p_chan uuid,p_keyword text,p_extra jsonb) returns uuid
language plpgsql as $$
declare org uuid; aid uuid; t uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); e uuid:=gen_random_uuid();
begin
  select organization_id into org from public.channels where id=p_chan;
  aid:=public.save_automation(org,null,'Live '||p_keyword,'instagram_comment',
    jsonb_build_object('channelId',p_chan,'mediaId',null,'keywords',jsonb_build_array(p_keyword),'mode','contains','oncePerUser',true)||p_extra,
    jsonb_build_object('nodes',jsonb_build_array(
      jsonb_build_object('id',t,'type','trigger','config','{}'::jsonb),
      jsonb_build_object('id',m,'type','message','config',jsonb_build_object('mode','text','text','Oi da live')),
      jsonb_build_object('id',e,'type','end','config','{}'::jsonb)),
      'edges',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'source',t,'target',m,'sourceHandle','default'),
        jsonb_build_object('id',gen_random_uuid(),'source',m,'target',e,'sourceHandle','default'))));
  perform public.activate_automation(aid);
  return aid;
end $$;
create function pg_temp.comment(p_conn uuid,p_id text,p_sender text,p_text text,p_media text,p_live boolean) returns uuid
language sql as $$
  select (public.ingest_instagram_event(p_conn,jsonb_build_object('kind','comment','accountId','78960','externalId',p_id,
    'commentId',p_id,'mediaId',p_media,'senderExternalId',p_sender,'text',p_text,'occurredAt',now())
    ||case when p_live then '{"mediaProductType":"LIVE"}'::jsonb else '{}'::jsonb end)->>'eventId')::uuid
$$;
create function pg_temp.state(p_event uuid) returns text language sql as $$
  select state from public.instagram_events where id=p_event
$$;
create extension if not exists pgtap with schema extensions;
select no_plan();

select tests.create_user('owner60@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org60') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"160","appSecret":"app","accessToken":"access","accountId":"78960","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);

select tests.authenticate_as(:'ua');
select pg_temp.save_rule(:'chan','alfa','{}'::jsonb) as rule_posts \gset
select pg_temp.save_rule(:'chan','beta','{"source":"lives"}'::jsonb) as rule_lives \gset
select pg_temp.save_rule(:'chan','gama','{"source":"both","publicReplies":["Te mandei no Direct!"]}'::jsonb) as rule_both \gset
select tests.clear_authentication();

-- 1–2. Origem.
select is(pg_temp.state(pg_temp.comment(:'conn','l1','901','alfa','live1',true)),'ignored','automação sem origem não dispara em comentário de live');
select is(pg_temp.state(pg_temp.comment(:'conn','p1','901','beta','80060',false)),'ignored','automação de lives não dispara em comentário de post');

-- 3–5. Uma vez por live.
select pg_temp.comment(:'conn','l2','902','beta','live1',true) as ev_live \gset
select is(pg_temp.state(:'ev_live'),'pending','automação de lives dispara em comentário de live');
select is((select automation_id from public.instagram_events where id=:'ev_live'),:'rule_lives'::uuid,'live selecionada pela automação de lives');
select is(pg_temp.state(pg_temp.comment(:'conn','l3','902','beta de novo','live1',true)),'ignored','segundo comentário na mesma live não dispara');
select is(pg_temp.state(pg_temp.comment(:'conn','l4','902','beta','live2',true)),'pending','comentário em outra live dispara de novo');

-- 6. Ambos: DM nos dois, resposta pública só no post; a live não bloqueia o post.
select pg_temp.comment(:'conn','l5','903','gama','live1',true) as ev_both_live \gset
select is(pg_temp.state(:'ev_both_live'),'pending','automação ambos dispara em live');
select is((select count(*)::int from public.instagram_comment_public_replies where event_id=:'ev_both_live'),0,'comentário de live não gera resposta pública');
select pg_temp.comment(:'conn','p2','903','gama','80060',false) as ev_both_post \gset
select is(pg_temp.state(:'ev_both_post'),'pending','DM recebida em live não bloqueia o comentário em post');
select is((select count(*)::int from public.instagram_comment_public_replies where event_id=:'ev_both_post'),1,'comentário de post gera resposta pública');

-- 7. Reseleção respeita a origem: sem a automação de lives, a de posts não assume a live.
update public.automations set activated_at=now()+interval '1 hour' where id=:'rule_lives';
select tests.authenticate_as(:'ua');
select pg_temp.save_rule(:'chan','beta','{}'::jsonb) as rule_posts_beta \gset
select tests.clear_authentication();
select is(public.reselect_instagram_comment_rule(:'ev_live',now()),'null'::jsonb,'reseleção não escolhe automação de posts para comentário de live');

select * from finish();
rollback;
