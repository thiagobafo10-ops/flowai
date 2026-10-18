begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select tests.create_user('owner53@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org53') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"153","appSecret":"app","accessToken":"access","accountId":"78953","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn, (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select public.verify_instagram_media(:'conn',:'chan','80053',1);

-- Automação 1: padrão (oncePerUser: true implícito ou explícito)
insert into public.instagram_comment_rules(organization_id,channel_id,keyword,reply_text,active,media_id,updated_at) values
 (:'oa',:'chan','guia','Olá! Aqui está o guia',true,'80053',now()-interval '1 hour') returning id as auto \gset
select private.migrate_instagram_comment_rules();

-- Primeiro comentário do usuário 953: deve casar e ficar pending
select public.ingest_instagram_event(:'conn',jsonb_build_object(
  'kind','comment','accountId','78953','externalId','c53_1','commentId','c53_1','mediaId','80053',
  'senderExternalId','953','text','quero o guia','occurredAt',now()
)) as first_comment \gset
select is((:'first_comment'::jsonb->>'state'),'pending','primeiro comentário do usuário fica pending');

-- Segundo comentário do mesmo usuário 953 no mesmo post: deve ser ignorado para evitar disparos repetidos
select public.ingest_instagram_event(:'conn',jsonb_build_object(
  'kind','comment','accountId','78953','externalId','c53_2','commentId','c53_2','mediaId','80053',
  'senderExternalId','953','text','guia por favor','occurredAt',now()
)) as second_comment \gset
select is((:'second_comment'::jsonb->>'state'),'ignored','segundo comentário do mesmo usuário é ignorado quando oncePerUser é true');

-- Comentário de outro usuário 954 no mesmo post: deve ser processado normalmente
select public.ingest_instagram_event(:'conn',jsonb_build_object(
  'kind','comment','accountId','78953','externalId','c53_3','commentId','c53_3','mediaId','80053',
  'senderExternalId','954','text','quero o guia','occurredAt',now()
)) as other_user_comment \gset
select is((:'other_user_comment'::jsonb->>'state'),'pending','comentário de outro usuário é processado');

-- Automação 2: com oncePerUser explicitamente desativado (false)
update public.automation_versions
  set trigger_config = trigger_config || '{"oncePerUser":false}'::jsonb
  where automation_id = :'auto';

select public.ingest_instagram_event(:'conn',jsonb_build_object(
  'kind','comment','accountId','78953','externalId','c53_4','commentId','c53_4','mediaId','80053',
  'senderExternalId','955','text','quero o guia','occurredAt',now()
)) as c55_1 \gset
select is((:'c55_1'::jsonb->>'state'),'pending','oncePerUser=false: primeiro comentário fica pending');

select public.ingest_instagram_event(:'conn',jsonb_build_object(
  'kind','comment','accountId','78953','externalId','c53_5','commentId','c53_5','mediaId','80053',
  'senderExternalId','955','text','guia de novo','occurredAt',now()
)) as c55_2 \gset
select is((:'c55_2'::jsonb->>'state'),'pending','oncePerUser=false: segundo comentário do mesmo usuário também dispara');

select * from finish();
rollback;
