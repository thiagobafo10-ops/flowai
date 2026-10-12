begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
select tests.create_user('owner34@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org34A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"134","appSecret":"app","accessToken":"access","accountId":"78934","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
-- R1 é a regra mais antiga, mas foi reativada há 10 min; R2 está ativa há 1h.
insert into public.instagram_comment_rules(id,organization_id,channel_id,keyword,reply_text,active,created_at,updated_at) values
  ('00000000-0000-4000-8000-000000003401',:'oa',:'chan','guia','Resposta R1',true,now()-interval '2 hours',now()-interval '10 minutes'),
  ('00000000-0000-4000-8000-000000003402',:'oa',:'chan','guia','Resposta R2',true,now()-interval '1 hour',now()-interval '1 hour'),
  ('00000000-0000-4000-8000-000000003403',:'oa',:'chan','futuro','Resposta R3',true,now()-interval '3 hours',now()+interval '1 hour'),
  ('00000000-0000-4000-8000-000000003404',:'oa',:'chan','futuro','Resposta R4',true,now()-interval '1 hour',now()-interval '1 hour');

select ok(not has_function_privilege('authenticated','public.reselect_instagram_comment_rule(uuid,timestamptz)','execute'), 'reseleção é só de serviço');
-- Ingestão: regra mais antiga cuja vigência começou até o recebimento.
select (public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78934','externalId','c34b','commentId','c34b','mediaId','80034','senderExternalId','934','text','futuro','occurredAt',now()))->>'eventId') as ev_future \gset
select is((select rule_id from public.instagram_events where id=:'ev_future'), '00000000-0000-4000-8000-000000003404'::uuid, 'regra com vigência futura não é escolhida na ingestão');
select (public.ingest_instagram_event(:'conn',jsonb_build_object('kind','comment','accountId','78934','externalId','c34','commentId','c34','mediaId','80034','senderExternalId','934','text','quero o guia','occurredAt',now()))->>'eventId') as ev \gset
select is((select rule_id from public.instagram_events where id=:'ev'), '00000000-0000-4000-8000-000000003401'::uuid, 'ingestão escolhe a regra mais antiga vigente');
select public.prepare_instagram_comment_send(:'ev');
select is((select text from public.instagram_send_intents where event_id=:'ev'), 'Resposta R1', 'intent nasce com a regra escolhida');

-- Worker: o comentário real é de 30 min atrás, antes da reativação de R1 → cai para R2.
select public.reselect_instagram_comment_rule(:'ev', now()-interval '30 minutes') as reselected \gset
select is((:'reselected'::jsonb->>'state'), 'pending', 'reseleção devolve trabalho preparado');
select is((select rule_id from public.instagram_events where id=:'ev'), '00000000-0000-4000-8000-000000003402'::uuid, 'evento passa para a próxima regra elegível');
select is((select text from public.instagram_send_intents where event_id=:'ev'), 'Resposta R2', 'intent usa a resposta da nova regra');
select ok((:'reselected'::jsonb->>'ruleEffectiveAt')::timestamptz <= now()-interval '30 minutes', 'nova vigência cobre o comentário');
-- Comentário anterior a todas as regras: nenhuma elegível.
select is(public.reselect_instagram_comment_rule(:'ev', now()-interval '5 hours'), 'null'::jsonb, 'sem regra elegível não há resposta');
-- Intent já reivindicado nunca troca de texto.
select public.claim_instagram_send((select id from public.instagram_send_intents where event_id=:'ev'));
select is(public.reselect_instagram_comment_rule(:'ev', now()-interval '30 minutes'), 'null'::jsonb, 'intent em envio não é alterado');
select * from finish();
rollback;
