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
select plan(6);
select tests.create_user('owner54@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org54A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"154","appSecret":"app","accessToken":"access","accountId":"78954","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select public.verify_instagram_media(:'conn',:'chan','80054',1);
select tests.authenticate_as(:'ua');
-- Regra ligada a um post específico: a publicação orgânica que foi impulsionada.
select pg_temp.save_comment_automation(jsonb_build_object('channelId',:'chan','keyword','guia','replyText','Aqui está','mediaId','80054','active',true)) as rule \gset
select tests.clear_authentication();
-- Comentário em anúncio: media.id é a mídia do anúncio; original_media_id é o post configurado.
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78954','externalId','ad54','commentId','ad54','mediaId','99154','originalMediaId','80054','mediaProductType','AD','senderExternalId','954','text','quero o guia','occurredAt',now())) as ev \gset
select is((select automation_id from public.instagram_events where external_id='ad54'),:'rule'::uuid,'ad comment selects the rule scoped to the boosted original post');
select is(:'ev'::jsonb->>'state','pending','ad comment is queued');
select public.prepare_instagram_comment_send((:'ev'::jsonb->>'eventId')::uuid) as work \gset
select is((:'work'::jsonb->>'originalMediaId'),'80054','prepared work carries the original media id');
select is((:'work'::jsonb->>'mediaId'),'99154','prepared work keeps the ad media id');
-- oncePerUser: mesmo usuário, mesmo post (via original_media_id), não dispara de novo.
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78954','externalId','ad54b','commentId','ad54b','mediaId','99154','originalMediaId','80054','mediaProductType','AD','senderExternalId','954','text','quero o guia','occurredAt',now())) as ev2 \gset
select is((select automation_id from public.instagram_events where external_id='ad54b'),null::uuid,'oncePerUser groups ad comments by the original media');
-- Comentário em anúncio de OUTRO post não casa a regra específica.
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78954','externalId','ad54c','commentId','ad54c','mediaId','99155','originalMediaId','80055','mediaProductType','AD','senderExternalId','955','text','quero o guia','occurredAt',now())) as ev3 \gset
select is((select automation_id from public.instagram_events where external_id='ad54c'),null::uuid,'ad comment on a different post does not match');
select * from finish();
rollback;
