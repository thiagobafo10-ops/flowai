begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
select tests.create_user('owner33@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org33A') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"133","appSecret":"app","accessToken":"access","accountId":"78933","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select public.ingest_instagram_event(:'conn',jsonb_build_object('kind','message','accountId','78933','externalId','m33','senderExternalId','933','text','Oi','occurredAt',now()));
select (select conversation_id from public.messages where external_id='m33') as conv \gset
select tests.authenticate_as(:'ua');
select public.create_instagram_send_intent(:'conv','Travado','00000000-0000-0000-0000-000000003301') as stuck \gset
select public.create_instagram_send_intent(:'conv','Órfão','00000000-0000-0000-0000-000000003302') as orphan \gset
select public.create_instagram_send_intent(:'conv','Recente','00000000-0000-0000-0000-000000003303') as fresh \gset
select public.create_instagram_send_intent(:'conv','Enviando','00000000-0000-0000-0000-000000003304') as live \gset
select tests.clear_authentication();
select public.claim_instagram_send(:'stuck');
select public.claim_instagram_send(:'live');
update public.instagram_send_intents set claimed_at=now()-interval '2 minutes' where id=:'stuck';
update public.instagram_send_intents set pending_since=now()-interval '11 minutes' where id=:'orphan';

select ok(not has_function_privilege('authenticated','public.sweep_instagram_send_intents()','execute'), 'varredura é só de serviço');
select public.sweep_instagram_send_intents();
select is((select state from public.instagram_send_intents where id=:'stuck'), 'uncertain', 'envio com lease vencido vira incerto');
select is((select error from public.messages where id=(select message_id from public.instagram_send_intents where id=:'stuck')),
  'Envio sem confirmação. Verifique o Instagram antes de tentar novamente.', 'mensagem mostra o texto de envio incerto');
select is((select status::text from public.messages where id=(select message_id from public.instagram_send_intents where id=:'stuck')), 'pending', 'incerto não vira falha');
select is((select state from public.instagram_send_intents where id=:'orphan'), 'failed', 'pendente há mais de 10 min vira falha');
select is((select error_code from public.instagram_send_intents where id=:'orphan'), 'not_dispatched', 'falha identifica que nada foi enviado');
select is((select status::text from public.messages where id=(select message_id from public.instagram_send_intents where id=:'orphan')), 'failed', 'mensagem órfã aparece como falha');
select is((select state from public.instagram_send_intents where id=:'fresh'), 'pending', 'pendente recente é mantido');
select is((select state from public.instagram_send_intents where id=:'live'), 'sending', 'envio em andamento é mantido');

-- A falha por não envio é segura para nova tentativa explícita.
select (select message_id from public.instagram_send_intents where id=:'orphan') as orphan_msg \gset
select tests.authenticate_as(:'ua');
select is(public.retry_instagram_send_intent(:'orphan_msg'), :'orphan'::uuid, 'falha não enviada pode ser reenviada');
select tests.clear_authentication();
select public.sweep_instagram_send_intents();
select is((select state from public.instagram_send_intents where id=:'orphan'), 'pending', 'reenvio recomeça a contagem dos 10 min');

-- O cron por minuto executa a varredura mesmo sem worker configurado.
update public.instagram_send_intents set claimed_at=now()-interval '2 minutes' where id=:'live';
select public.dispatch_instagram_worker();
select is((select state from public.instagram_send_intents where id=:'live'), 'uncertain', 'dispatch por minuto varre envios travados');

-- Fila vazia não gera chamada HTTP ao worker; com trabalho visível, gera.
select public.configure_instagram_worker('http://kong:8000', repeat('k',40), repeat('w',40));
delete from pgmq.q_instagram_work;
select count(*)::int as before_http from net.http_request_queue \gset
select public.dispatch_instagram_worker();
select is((select count(*)::int from net.http_request_queue), :before_http, 'fila vazia não chama o worker');
select pgmq.send('instagram_work', jsonb_build_object('eventId', gen_random_uuid()));
select public.dispatch_instagram_worker();
select is((select count(*)::int from net.http_request_queue), :before_http + 1, 'trabalho visível chama o worker');
select * from finish();
rollback;
