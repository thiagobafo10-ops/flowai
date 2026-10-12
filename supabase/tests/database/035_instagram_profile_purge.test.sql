begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
select tests.create_user('owner35@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org35A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"135","appSecret":"app","accessToken":"access","accountId":"78935","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
delete from pgmq.q_instagram_work;

-- Item 7: Direct de contato sem nome agenda busca de perfil (best-effort).
select (public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78935','externalId','m35','senderExternalId','935','text','Oi','occurredAt',now()))->>'eventId') as ev \gset
select is((select count(*)::int from pgmq.q_instagram_work where message->>'task'='profile' and message->>'eventId'=:'ev'), 1, 'Direct sem nome agenda perfil');
select public.read_instagram_work(10) as jobs \gset
select is(:'jobs'::jsonb->0->>'task', 'profile', 'worker recebe o tipo da tarefa');
select ok(not has_function_privilege('authenticated','public.prepare_instagram_profile(uuid)','execute'), 'preparo de perfil é só de serviço');
select public.prepare_instagram_profile(:'ev') as profile \gset
select is(:'profile'::jsonb->>'senderExternalId', '935', 'preparo devolve o remetente');
select is(:'profile'::jsonb->>'connectionId', :'conn', 'preparo devolve a conexão');
select public.save_instagram_contact_name(:'ev', '  Maria Cliente  ');
select is((select name from public.contacts where instagram_id='935' and organization_id=:'oa'), 'Maria Cliente', 'nome do perfil gravado');
select public.save_instagram_contact_name(:'ev', 'Outro Nome');
select is((select name from public.contacts where instagram_id='935' and organization_id=:'oa'), 'Maria Cliente', 'nome existente nunca é sobrescrito');
select is(public.prepare_instagram_profile(:'ev'), 'null'::jsonb, 'contato com nome não busca perfil');
select public.finish_instagram_work((:'jobs'::jsonb->0->>'queueId')::bigint, 'failed', 'profile_unavailable');
select is((select state from public.instagram_events where id=:'ev'), 'done', 'falha de perfil nunca altera o evento');
select is((select count(*)::int from pgmq.q_instagram_work where msg_id=(:'jobs'::jsonb->0->>'queueId')::bigint), 0, 'tarefa de perfil sai da fila');
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78935','externalId','m35b','senderExternalId','935','text','De novo','occurredAt',now()));
select is((select count(*)::int from pgmq.q_instagram_work where message->>'task'='profile'), 0, 'contato com nome não agenda perfil');

-- Item 10: comentário ignorado encerra o intent pendente.
select tests.authenticate_as(:'ua');
select public.save_instagram_comment_rule(jsonb_build_object('channelId',:'chan','keyword','guia','replyText','Aqui','active',true));
select tests.clear_authentication();
select (public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78935','externalId','c35','commentId','c35','mediaId','80035','senderExternalId','936','senderName','Ana','text','guia','occurredAt',now()))->>'eventId') as cev \gset
select public.prepare_instagram_comment_send(:'cev');
select (select msg_id from pgmq.q_instagram_work where message->>'eventId'=:'cev') as cq \gset
select public.finish_instagram_work(:'cq', 'ignored', 'comment_not_eligible');
select is((select state from public.instagram_send_intents where event_id=:'cev'), 'failed', 'comentário ignorado falha o intent pendente');

-- Item 10: excluir o contato do CRM apaga payloads e encerra respostas privadas pendentes.
select (public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78935','externalId','c35b','commentId','c35b','mediaId','80035','senderExternalId','935','senderName','Maria','text','guia de novo','occurredAt',now()))->>'eventId') as pev \gset
select public.prepare_instagram_comment_send(:'pev');
delete from public.contacts where instagram_id='935' and organization_id=:'oa';
select is((select count(*)::int from public.instagram_events where organization_id=:'oa' and payload->>'senderExternalId'='935'), 0, 'payloads do remetente apagados');
select is((select state from public.instagram_send_intents where event_id=:'pev'), 'failed', 'resposta privada pendente encerrada');
select is((select state from public.instagram_events where id=:'pev'), 'ignored', 'comentário pendente não será processado');
select is((select count(*)::int from public.instagram_events where organization_id=:'oa' and payload->>'senderExternalId'='936'), 1, 'outros remetentes intactos');
select * from finish();
rollback;
