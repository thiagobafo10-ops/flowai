begin;
-- Resposta pública ao comentário que disparou a automação: operação própria,
-- independente da resposta privada (Direct), com texto sorteado e congelado na fila.
create function pg_temp.save_comment_automation(p_input jsonb) returns uuid
language plpgsql as $$
declare org uuid; aid uuid; t uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); cfg jsonb;
begin
  select organization_id into org from public.channels where id=(p_input->>'channelId')::uuid;
  cfg:=jsonb_build_object('channelId',p_input->>'channelId','mediaId',p_input->>'mediaId',
      'keywords',jsonb_build_array(p_input->>'keyword'),'mode','contains');
  if p_input ? 'publicReplies' then cfg:=cfg||jsonb_build_object('publicReplies',p_input->'publicReplies'); end if;
  aid:=public.save_automation(org,(p_input->>'id')::uuid,'Comentário','instagram_comment',cfg,
    jsonb_build_object('nodes',jsonb_build_array(
      jsonb_build_object('id',t,'type','trigger','config','{}'::jsonb),
      jsonb_build_object('id',m,'type','message','config',jsonb_build_object('mode','text','text','Aqui está')),
      jsonb_build_object('id',e,'type','end','config','{}'::jsonb)),
      'edges',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'source',t,'target',m,'sourceHandle','default'),
        jsonb_build_object('id',gen_random_uuid(),'source',m,'target',e,'sourceHandle','default'))));
  perform public.activate_automation(aid);
  return aid;
end $$;
create function pg_temp.comment(p_conn uuid,p_id text,p_sender text,p_text text,p_media text default '80056') returns uuid
language sql as $$
  select (public.ingest_instagram_event(p_conn,jsonb_build_object('kind','comment','accountId','78956','externalId',p_id,
    'commentId',p_id,'mediaId',p_media,'senderExternalId',p_sender,'text',p_text,'occurredAt',now()))->>'eventId')::uuid
$$;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table('public','instagram_comment_public_replies','public replies persist apart from send intents');
select has_function('public','prepare_instagram_comment_public_reply',array['uuid'],'prepare RPC exists');
select has_function('public','claim_instagram_comment_public_reply',array['uuid','timestamp with time zone','uuid','integer'],'claim RPC exists');
select has_function('public','complete_instagram_comment_public_reply',array['uuid','uuid','text','text','text'],'complete RPC exists');
select has_function('public','finish_instagram_comment_public_reply_work',array['bigint','text','text'],'finish RPC exists');

select tests.create_user('owner56@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org56') as oa \gset
select public.save_instagram_connection(:'ua',:'oa','{"appId":"156","appSecret":"app","accessToken":"access","accountId":"78956","apiVersion":"v26.0"}') as saved \gset
select (:'saved'::jsonb->>'connectionId') as conn \gset
select (:'saved'::jsonb->>'channelId') as chan \gset
select public.set_meta_connection_verification(:'conn','token',true,null,1);
select public.set_meta_connection_verification(:'conn','webhook',true,null,1);
select public.verify_instagram_media(:'conn',:'chan','80056',1);
select credential_generation as gen from public.meta_connections where id=:'conn' \gset

-- Validação no salvamento (espelha o Zod).
select tests.authenticate_as(:'ua');
select throws_ok(format('select pg_temp.save_comment_automation(%L)',jsonb_build_object('channelId',:'chan','keyword','x','mediaId','80056',
  'publicReplies',(select jsonb_agg('r'||g) from generate_series(1,11) g))),'22023',null,'more than 10 variations rejected on save');
select throws_ok(format('select pg_temp.save_comment_automation(%L)',jsonb_build_object('channelId',:'chan','keyword','x','mediaId','80056',
  'publicReplies',jsonb_build_array('   '))),'22023',null,'blank variation rejected on save');
select throws_ok(format('select pg_temp.save_comment_automation(%L)',jsonb_build_object('channelId',:'chan','keyword','x','mediaId','80056',
  'publicReplies',jsonb_build_array(repeat('a',301)))),'22023',null,'variation over 300 characters rejected on save');
select throws_ok(format('select pg_temp.save_comment_automation(%L)',jsonb_build_object('channelId',:'chan','keyword','x','mediaId','80056',
  'publicReplies','"texto"'::jsonb)),'22023',null,'non-array publicReplies rejected on save');
select pg_temp.save_comment_automation(jsonb_build_object('channelId',:'chan','keyword','guia','mediaId','80056',
  'publicReplies',jsonb_build_array('Te mandei no Direct!','Confere o Direct','Enviado!'))) as rule \gset
select pg_temp.save_comment_automation(jsonb_build_object('channelId',:'chan','keyword','vazio','mediaId','80056','publicReplies','[]'::jsonb)) as rule_empty \gset
select pg_temp.save_comment_automation(jsonb_build_object('channelId',:'chan','keyword','ausente','mediaId','80056')) as rule_absent \gset
select tests.clear_authentication();

-- Enfileiramento: uma vez por evento, com texto sorteado entre as variações.
select pg_temp.comment(:'conn','c1','901','quero o guia') as ev1 \gset
select pg_temp.comment(:'conn','c1','901','quero o guia') as ev1b \gset
select is(:'ev1b'::uuid,:'ev1'::uuid,'redelivery returns the same event');
select is((select count(*)::int from public.instagram_comment_public_replies where event_id=:'ev1'),1,'one public reply per event');
select is((select count(*)::int from pgmq.q_instagram_work where message->>'task'='public_reply' and message->>'eventId'=:'ev1'),1,'public reply queued once');
select ok((select text in ('Te mandei no Direct!','Confere o Direct','Enviado!') from public.instagram_comment_public_replies where event_id=:'ev1'),'chosen text is one of the variations');
select text as chosen from public.instagram_comment_public_replies where event_id=:'ev1' \gset
select is((select automation_id from public.instagram_comment_public_replies where event_id=:'ev1'),:'rule'::uuid,'reply bound to the selecting automation');

select pg_temp.comment(:'conn','c2','902','vazio aqui') as ev_empty \gset
select pg_temp.comment(:'conn','c3','903','ausente aqui') as ev_absent \gset
select is((select automation_id from public.instagram_events where id=:'ev_empty'),:'rule_empty'::uuid,'empty-list rule still fires');
select is((select count(*)::int from public.instagram_comment_public_replies where event_id in (:'ev_empty',:'ev_absent')),0,'no public reply when publicReplies empty or absent');

-- Regra não selecionada: sem nada.
select pg_temp.comment(:'conn','c4','904','nada a ver') as ev_none \gset
select is((select count(*)::int from public.instagram_comment_public_replies where event_id=:'ev_none'),0,'no public reply when no rule matches');

-- oncePerUser: segundo comentário do mesmo usuário não gera nenhuma das duas respostas.
select pg_temp.comment(:'conn','c5','901','quero o guia de novo') as ev_twice \gset
select is((select count(*)::int from public.instagram_comment_public_replies where event_id=:'ev_twice'),0,'oncePerUser: second comment gets no public reply');
select is(public.prepare_instagram_comment_send(:'ev_twice'),'null'::jsonb,'oncePerUser: second comment gets no private reply');

-- Comentário da própria conta: ignorado.
select pg_temp.comment(:'conn','c6','78956','quero o guia') as ev_own \gset
select is((select count(*)::int from public.instagram_comment_public_replies where event_id=:'ev_own'),0,'own-account comment never gets a public reply');

-- Preparação estável.
select public.prepare_instagram_comment_public_reply(:'ev1') as p1 \gset
select is(:'p1'::jsonb->>'state','pending','prepared reply is pending');
select is(:'p1'::jsonb->>'commentId','c1','prepared reply carries the comment id');
select public.prepare_instagram_comment_public_reply(:'ev1');
select is((select text from public.instagram_comment_public_replies where event_id=:'ev1'),:'chosen','chosen text stable across re-prepare');
select (:'p1'::jsonb->>'replyId') as r1 \gset

-- Autenticado não chama as RPCs de serviço nem lê a tabela.
select tests.authenticate_as(:'ua');
select throws_ok(format('select public.prepare_instagram_comment_public_reply(%L)',:'ev1'),'42501',null,'authenticated cannot prepare');
select throws_ok(format('select public.claim_instagram_comment_public_reply(%L,now(),%L,1)',:'r1',:'conn'),'42501',null,'authenticated cannot claim');
select throws_ok(format('select public.complete_instagram_comment_public_reply(%L,%L,''sent'',''x'',null)',:'r1',gen_random_uuid()),'42501',null,'authenticated cannot complete');
select throws_ok('select public.finish_instagram_comment_public_reply_work(1,''done'',null)','42501',null,'authenticated cannot finish work');
select throws_ok('select count(*) from public.instagram_comment_public_replies','42501',null,'authenticated cannot read the table');
select tests.clear_authentication();
select ok((select relrowsecurity from pg_class where oid='public.instagram_comment_public_replies'::regclass),'RLS enabled');

-- Falha do Direct não afeta a resposta pública.
select public.prepare_instagram_comment_send(:'ev1') as dm1 \gset
select public.claim_instagram_send((:'dm1'::jsonb->>'intentId')::uuid) as dmclaim \gset
select public.complete_instagram_send((:'dm1'::jsonb->>'intentId')::uuid,jsonb_build_object('state','failed','claimToken',:'dmclaim'::jsonb->>'claimToken','errorCode','provider_rejected'));
select msg_id as dmq from pgmq.q_instagram_work where message->>'eventId'=:'ev1' and message->>'task' is null \gset
select public.finish_instagram_work(:'dmq','failed','provider_rejected');
select is((select state from public.instagram_comment_public_replies where id=:'r1'),'pending','DM failure leaves the public reply pending');
select is(public.claim_instagram_comment_public_reply(:'r1',now(),:'conn',:'gen'::integer)->>'text',:'chosen','public reply still claimable with the frozen text');

-- Reserva única; 429 volta para pendente; incerto nunca é refeito.
select is(public.claim_instagram_comment_public_reply(:'r1',now(),:'conn',:'gen'::integer),'null'::jsonb,'sending reply cannot be claimed twice');
select claim_token as tok from public.instagram_comment_public_replies where id=:'r1' \gset
select throws_ok(format('select public.complete_instagram_comment_public_reply(%L,%L,''pending'',null,''provider_rejected'')',:'r1',:'tok'),'22023',null,'only rate limit may go back to pending');
select public.complete_instagram_comment_public_reply(:'r1',:'tok','pending',null,'rate_limited');
select is((select state from public.instagram_comment_public_replies where id=:'r1'),'pending','429 returns the reply to pending');
select isnt(public.claim_instagram_comment_public_reply(:'r1',now(),:'conn',:'gen'::integer),'null'::jsonb,'rate-limited reply is claimed again later');
select claim_token as tok2 from public.instagram_comment_public_replies where id=:'r1' \gset
select public.complete_instagram_comment_public_reply(:'r1',:'tok2','uncertain',null,'network_error');
select is((select state from public.instagram_comment_public_replies where id=:'r1'),'uncertain','timeout becomes uncertain');
select is(public.claim_instagram_comment_public_reply(:'r1',now(),:'conn',:'gen'::integer),'null'::jsonb,'uncertain reply is never claimed again');
select is(public.prepare_instagram_comment_public_reply(:'ev1')->>'state','uncertain','uncertain stays uncertain on re-prepare');

-- Falha da resposta pública não afeta o Direct (e vice-versa na fila).
-- (r1 incerta aparece na Saúde/Ops junto dos erros de envio.)
select tests.authenticate_as(:'ua');
select ok(public.ops_health(:'oa')->'send_intents'->'top_errors' @> '[{"code":"network_error"}]'::jsonb,'public reply errors surface in ops health');
select tests.clear_authentication();
select pg_temp.comment(:'conn','c7','907','quero o guia') as ev7 \gset
select (public.prepare_instagram_comment_public_reply(:'ev7')->>'replyId') as r7 \gset
select public.claim_instagram_comment_public_reply(:'r7',now(),:'conn',:'gen'::integer)->>'claimToken' as tok7 \gset
select public.complete_instagram_comment_public_reply(:'r7',:'tok7','failed',null,'permission_denied');
select is((select error_code from public.instagram_comment_public_replies where id=:'r7'),'permission_denied','permission error recorded as a code');
select public.prepare_instagram_comment_send(:'ev7') as dm7 \gset
select is(:'dm7'::jsonb->>'state','pending','public reply failure leaves the DM pending');
select isnt(public.claim_instagram_send((:'dm7'::jsonb->>'intentId')::uuid),'null'::jsonb,'DM still claimable after public reply failure');
select msg_id as pq7 from pgmq.q_instagram_work where message->>'eventId'=:'ev7' and message->>'task'='public_reply' \gset
select public.finish_instagram_comment_public_reply_work(:'pq7','failed','permission_denied');
select is((select state from public.instagram_events where id=:'ev7'),'pending','public reply acknowledgement never changes the event');
select is((select count(*)::int from pgmq.q_instagram_work where msg_id=:'pq7'),0,'public reply work archived');

-- Concessão expirada vira incerta, nunca é reenviada.
select pg_temp.comment(:'conn','c8','908','quero o guia') as ev8 \gset
select (public.prepare_instagram_comment_public_reply(:'ev8')->>'replyId') as r8 \gset
select public.claim_instagram_comment_public_reply(:'r8',now(),:'conn',:'gen'::integer);
update public.instagram_comment_public_replies set claimed_at=now()-interval '10 minutes' where id=:'r8';
select is(public.prepare_instagram_comment_public_reply(:'ev8')->>'state','uncertain','expired lease becomes uncertain');
select is((select error_code from public.instagram_comment_public_replies where id=:'r8'),'expired_send_lease','expired lease code recorded');

-- Comentário anterior à ativação da regra: não reserva.
select pg_temp.comment(:'conn','c9','909','quero o guia') as ev9 \gset
select (public.prepare_instagram_comment_public_reply(:'ev9')->>'replyId') as r9 \gset
select is(public.claim_instagram_comment_public_reply(:'r9',now()-interval '1 hour',:'conn',:'gen'::integer),'null'::jsonb,'comment predating the rule is not replied');
select is(public.claim_instagram_comment_public_reply(:'r9',now(),:'conn',:'gen'::integer+1),'null'::jsonb,'stale credential snapshot cannot claim');

-- VIP já tem operação pública para o comentário: pula.
insert into public.instagram_vip_intents(organization_id,channel_id,event_id,comment_id,kind,state)
values(:'oa',:'chan',null,'c9','public','pending');
select is(public.claim_instagram_comment_public_reply(:'r9',now(),:'conn',:'gen'::integer),'null'::jsonb,'VIP public operation blocks the automation public reply');
select is((select state||':'||error_code from public.instagram_comment_public_replies where id=:'r9'),'skipped:vip_replied','skipped with reason vip_replied');

-- Simétrico: resposta pública da automação reservada impede a do VIP.
select pg_temp.comment(:'conn','c10','910','quero o guia') as ev10 \gset
select (public.prepare_instagram_comment_public_reply(:'ev10')->>'replyId') as r10 \gset
select isnt(public.claim_instagram_comment_public_reply(:'r10',now(),:'conn',:'gen'::integer),'null'::jsonb,'automation public reply reserved first');
select public.record_instagram_vip_capability(:'chan',:'gen'::integer,true,null);
update public.instagram_vip_settings set enabled=true,activated_at=now()-interval '1 hour' where channel_id=:'chan';
insert into public.instagram_vip_intents(organization_id,channel_id,event_id,comment_id,kind,state)
values(:'oa',:'chan',:'ev10','c10','public','pending') returning id as vip10 \gset
select is(public.claim_instagram_vip_send(:'vip10',now(),'VIP',:'conn',:'gen'::integer),'null'::jsonb,'VIP skips its public reply when the automation already replied');
select is((select state||':'||error_code from public.instagram_vip_intents where id=:'vip10'),'cancelled:automation_replied','VIP public op cancelled with reason');
update public.instagram_vip_settings set enabled=false where channel_id=:'chan';

-- Automação pausada entre preparar e reservar: não reserva.
select pg_temp.comment(:'conn','c11','911','quero o guia') as ev11 \gset
select (public.prepare_instagram_comment_public_reply(:'ev11')->>'replyId') as r11 \gset
select tests.authenticate_as(:'ua');
select public.pause_automation(:'rule');
select tests.clear_authentication();
select is(public.claim_instagram_comment_public_reply(:'r11',now(),:'conn',:'gen'::integer),'null'::jsonb,'paused automation between prepare and claim blocks the reply');
select is(public.prepare_instagram_comment_public_reply(:'ev11'),'null'::jsonb,'paused automation is not prepared');
select tests.authenticate_as(:'ua');
select public.activate_automation(:'rule');
select tests.clear_authentication();

-- Canal inativo: não reserva.
update public.channels set status='error' where id=:'chan';
select is(public.claim_instagram_comment_public_reply(:'r11',now(),:'conn',:'gen'::integer),'null'::jsonb,'inactive channel blocks the reply');
update public.channels set status='active' where id=:'chan';

-- Sem expiração: fila encerrada sem envio cancela a pendente.
select msg_id as pq11 from pgmq.q_instagram_work where message->>'eventId'=:'ev11' and message->>'task'='public_reply' \gset
select public.finish_instagram_comment_public_reply_work(:'pq11','ignored','comment_not_eligible');
select is((select state||':'||error_code from public.instagram_comment_public_replies where id=:'r11'),'cancelled:comment_not_eligible','ineligible comment cancels the pending reply');
select pg_temp.comment(:'conn','c12','912','quero o guia') as ev12 \gset
select msg_id as pq12 from pgmq.q_instagram_work where message->>'eventId'=:'ev12' and message->>'task'='public_reply' \gset
select public.finish_instagram_comment_public_reply_work(:'pq12','retry','rate_limited');
select is((select count(*)::int from pgmq.q_instagram_work where msg_id=:'pq12'),1,'retry keeps the work queued');

-- Versão congelada: o rascunho vivo não é lido.
update public.automations set trigger_config=trigger_config||'{"publicReplies":["RASCUNHO"]}'::jsonb where id=:'rule';
select pg_temp.comment(:'conn','c13','913','quero o guia') as ev13 \gset
select ok((select text in ('Te mandei no Direct!','Confere o Direct','Enviado!') from public.instagram_comment_public_replies where event_id=:'ev13'),'text comes from the frozen version, not the live draft');

select * from finish();
rollback;
