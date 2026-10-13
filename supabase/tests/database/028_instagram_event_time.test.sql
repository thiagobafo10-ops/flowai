begin;
-- Authenticated automation authoring fixture (no privileged write bypass).
create function pg_temp.save_comment_automation(p_input jsonb) returns uuid
language plpgsql as $$
declare org uuid; aid uuid; t uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); e uuid:=gen_random_uuid();
begin
  select organization_id into org from public.channels where id=(p_input->>'channelId')::uuid;
  aid:=public.save_automation(org,(p_input->>'id')::uuid,'Comentário','instagram_comment',
    jsonb_build_object('channelId',p_input->>'channelId','mediaId',p_input->>'mediaId',
      'keywords',jsonb_build_array(p_input->>'keyword'),'mode','contains'),
    jsonb_build_object('nodes',jsonb_build_array(
      jsonb_build_object('id',t,'type','trigger','config','{}'::jsonb),
      jsonb_build_object('id',m,'type','message','config',jsonb_build_object('mode','text','text',p_input->>'replyText')),
      jsonb_build_object('id',e,'type','end','config','{}'::jsonb)),
      'edges',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'source',t,'target',m,'sourceHandle','default'),
        jsonb_build_object('id',gen_random_uuid(),'source',m,'target',e,'sourceHandle','default'))));
  if (p_input->>'active')::boolean then perform public.activate_automation(aid);
  else perform public.pause_automation(aid); end if;
  return aid;
end $$;
create extension if not exists pgtap with schema extensions;
select plan(2);
select tests.create_user('owner28@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org28A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"128","appSecret":"app","accessToken":"access","accountId":"78928","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select tests.authenticate_as(:'ua');
select pg_temp.save_comment_automation(jsonb_build_object('channelId',:'chan','keyword','guia','replyText','Aqui','active',true)) as rule \gset
select tests.clear_authentication();
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78928','externalId','c28','commentId','c28','mediaId','p28','senderExternalId','928','text','guia','occurredAt',date_trunc('second',now()))) as ev \gset
select is((select automation_id from public.instagram_events where external_id='c28'),:'rule'::uuid,'second precision callback captures current automation; worker checks real comment time');
select is(:'ev'::jsonb->>'state','pending','new comment not discarded within same second as rule creation');
select * from finish();
rollback;
