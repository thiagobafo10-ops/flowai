begin;
-- Recuperação unificada: RPCs do atendimento manual de carrinhos.
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.cart(p_conn uuid,p_ext text,p_email text,p_url text,p_phone text default '+5511987654321') returns uuid
language sql as $$
  select public.ingest_yampi_event(p_conn,jsonb_build_object('kind','cart','event','cart.reminder','merchantAlias','loja',
    'customer',jsonb_build_object('email',p_email,'name','Ana Souza','phone',p_phone),
    'cart',jsonb_build_object('externalId',p_ext,'token','tok-'||p_ext,'total',89.9,'recoveryUrl',p_url,
      'items',jsonb_build_array(jsonb_build_object('name','Camiseta Maria','quantity',2,'price',30),
        jsonb_build_object('name','Terço','quantity',1,'price',29.9)))),'h-'||p_ext);
  select id from public.store_carts where connection_id=p_conn and external_id=p_ext;
$$;
create function pg_temp.paid(p_conn uuid,p_ext text,p_token text,p_email text) returns text
language sql as $$
  select public.ingest_yampi_event(p_conn,jsonb_build_object('kind','order','event','order.paid','merchantAlias','loja',
    'customer',jsonb_build_object('email',p_email,'name','Ana Souza','phone',null),
    'order',jsonb_build_object('externalId',p_ext,'number','N'||p_ext,'statusAlias','paid','paymentAlias','pix','total',89.9,
      'cartToken',p_token,'paid',true,'items','[]'::jsonb)),'hp-'||p_ext)->>'state'
$$;
create function pg_temp.contact(p_cart uuid) returns uuid
language sql as $$ select contact_id from public.store_carts where id=p_cart $$;
create function pg_temp.grant_perm(p_cart uuid,p_by uuid) returns void
language sql as $$
  insert into public.contact_channel_permissions(organization_id,contact_id,channel,status,source,evidence_at,recorded_by)
    select organization_id,contact_id,'whatsapp','granted','Conversa no Instagram',now(),p_by from public.store_carts where id=p_cart;
$$;
create function pg_temp.n_actions(p_cart uuid,p_action text) returns int
language sql as $$ select count(*)::int from public.cart_contact_actions where cart_id=p_cart and action=p_action $$;
create function pg_temp.sends(p_cart uuid) returns text
language sql as $$
  select string_agg(distinct state||'/'||coalesce(cancel_reason,'-'),',') from public.email_sends where cart_id=p_cart
$$;

select tests.create_user('owner64@t.test','Owner') as ua \gset
select tests.create_user('agent64@t.test','Agente Bia') as ug \gset
select tests.create_user('viewer64@t.test','Viewer') as uv \gset
select tests.create_user('other64@t.test','Other') as uc \gset
select tests.create_org(:'ua','Org64') as oa \gset
select tests.create_org(:'uc','Org64b') as ob \gset
select tests.add_member(:'oa',:'ug','agent');
select tests.add_member(:'oa',:'uv','viewer');

select tests.authenticate_as(:'ua');
select public.save_store_connection(:'oa','loja','s3cr3t') as conn \gset
select public.set_email_journey_enabled(:'oa','cart',true);
select tests.clear_authentication();
update public.store_connections set checkout_hosts='{allowed.host}' where id=:'conn';

-- Renderização pinada ao renderWhatsappMessage (packages/core/src/store/recovery.test.ts).
select is(private.render_whatsapp_message('Oi, {primeiro_nome}! Seu carrinho na {loja} ({valor}): {link}','Ana','https://x',89.9,'Holy Spirit','[]'),
  'Oi, Ana! Seu carrinho na Holy Spirit (R$ 89,90): https://x','render matches TS: fills variables');
select is(private.render_whatsapp_message('Oi, {primeiro_nome}! Seu carrinho na {loja} ({valor}): {link}',null,'https://x',89.9,'Holy Spirit','[]'),
  'Oi! Seu carrinho na Holy Spirit (R$ 89,90): https://x','render matches TS: orphan comma without name');
select is(private.render_whatsapp_message('{itens}','Ana','https://x',89.9,'Holy Spirit',
  '[{"name":"Camiseta Maria","quantity":2},{"name":"Terço","quantity":1}]'),'2x Camiseta Maria, 1x Terço','render matches TS: items');
select is(private.render_whatsapp_message('{primeiro_nome} total {valor}',null,'https://x',1234.5,'L','[]'),'Total R$ 1.234,50',
  'leading empty variable capitalizes; thousands separator');

select pg_temp.cart(:'conn','k1','ana@ex.com','https://allowed.host/r/k1') as k1 \gset
select pg_temp.contact(:'k1') as ck1 \gset

-- 12a. Autorização: evidência futura recusada; agent registra.
select tests.authenticate_as(:'ug');
select throws_ok(format($$select public.record_contact_permission(%L,%L,'granted','Conversa no Instagram',now()+interval '1 day')$$,:'oa',:'ck1'),
  '22023',null,'future evidence rejected');
select isnt(public.record_contact_permission(:'oa',:'ck1','granted','Conversa no Instagram',now()-interval '1 day'),null,'agent records permission');

-- 3. prepare em carrinho elegível (modelo padrão, loja = nome da organização).
select public.prepare_cart_whatsapp(:'oa',:'k1','rk-open-1') as p1 \gset
select is((:'p1'::jsonb)->>'phone','+5511987654321','prepare returns phone');
select is((:'p1'::jsonb)->>'message',
  'Oi, Ana! Aqui é da Org64. Vi que você deixou algumas peças no carrinho e quis te ajudar a finalizar. Se tiver qualquer dúvida, é só me responder por aqui. Seu carrinho continua guardado neste link: https://allowed.host/r/k1',
  'default template rendered with link and org name');
select ok((:'p1'::jsonb)->>'actionId' is not null,'prepare returns actionId');
select is(public.prepare_cart_whatsapp(:'oa',:'k1','rk-open-1')->>'actionId',(:'p1'::jsonb)->>'actionId','same request_key returns same action');
select tests.clear_authentication();
select is(pg_temp.n_actions(:'k1','opened_whatsapp'),1,'one opened_whatsapp');

-- Configurações: normalização, validação e papel.
select tests.authenticate_as(:'ua');
select lives_ok(format($$select public.save_cart_recovery_settings(%L,'Oi, {primeiro_nome}! {loja}: {link}',
  array['HTTPS://Allowed.Host./checkout?x=1',' ','allowed.host'])$$,:'oa'),'admin saves settings');
select throws_ok(format($$select public.save_cart_recovery_settings(%L,'Oi {link} tudo bem',array['nao e host'])$$,:'oa'),'22023',null,'invalid host rejected');
select throws_ok(format($$select public.save_cart_recovery_settings(%L,'curto',array[]::text[])$$,:'oa'),'22023',null,'short template rejected');
select tests.authenticate_as(:'ug');
select throws_ok(format($$select public.save_cart_recovery_settings(%L,'Oi {link} tudo bem',array[]::text[])$$,:'oa'),'42501',null,'agent cannot save settings');
select tests.clear_authentication();
select is((select checkout_hosts from public.store_connections where id=:'conn'),'{allowed.host}'::text[],'hosts normalized and deduplicated');
insert into public.email_settings(organization_id,from_name,from_email) values(:'oa','Holy Spirit','loja@ex.com');
select tests.authenticate_as(:'ug');
select is(public.prepare_cart_whatsapp(:'oa',:'k1','rk-open-2')->>'message','Oi, Ana! Holy Spirit: https://allowed.host/r/k1',
  'saved template and from_name used');

-- 2. viewer não opera; agent sim.
select tests.authenticate_as(:'uv');
select throws_ok(format($$select public.prepare_cart_whatsapp(%L,%L,'rk-v1')$$,:'oa',:'k1'),'42501',null,'viewer cannot prepare');
select throws_ok(format($$select public.record_cart_action(%L,%L,'note','rk-v2','Uma nota',false)$$,:'oa',:'k1'),'42501',null,'viewer cannot record action');
select throws_ok(format($$select public.record_contact_permission(%L,%L,'granted','Conversa',now())$$,:'oa',:'ck1'),'42501',null,'viewer cannot record permission');
select throws_ok(format($$select public.set_contact_blocked(%L,%L,true,'Motivo')$$,:'oa',:'ck1'),'42501',null,'viewer cannot block');
select is((public.list_store_carts(:'oa','{}',1,20)->>'total')::int>0,true,'viewer lists carts');
select is(public.get_store_cart(:'oa',:'k1')->>'id',:'k1','viewer reads cart');

-- 1. cross-org: operador de B com carrinho/contato de A.
select tests.clear_authentication();
select count(*) as before_actions from public.cart_contact_actions \gset
select count(*) as before_perms from public.contact_channel_permissions \gset
select tests.authenticate_as(:'uc');
select throws_ok(format($$select public.prepare_cart_whatsapp(%L,%L,'x1')$$,:'ob',:'k1'),'42501',null,'cross-org prepare (own org id)');
select throws_ok(format($$select public.prepare_cart_whatsapp(%L,%L,'x2')$$,:'oa',:'k1'),'42501',null,'cross-org prepare (foreign org id)');
select throws_ok(format($$select public.record_cart_action(%L,%L,'note','x3','Uma nota',false)$$,:'ob',:'k1'),'42501',null,'cross-org action');
select throws_ok(format($$select public.record_contact_permission(%L,%L,'revoked','Conversa',now())$$,:'ob',:'ck1'),'42501',null,'cross-org permission');
select throws_ok(format($$select public.set_contact_blocked(%L,%L,true,'Motivo')$$,:'ob',:'ck1'),'42501',null,'cross-org block');
select throws_ok(format($$select public.get_store_cart(%L,%L)$$,:'ob',:'k1'),'42501',null,'cross-org get (own org id)');
select throws_ok(format($$select public.get_store_cart(%L,%L)$$,:'oa',:'k1'),'42501',null,'cross-org get (foreign org id)');
select throws_ok(format($$select public.list_store_carts(%L,'{}',1,20)$$,:'oa'),'42501',null,'cross-org list');
select is((public.list_store_carts(:'ob','{}',1,20)->>'total')::int,0,'own org lists none');
select throws_ok(format($$select public.save_cart_recovery_settings(%L,'Oi {link} tudo bem',array[]::text[])$$,:'oa'),'42501',null,'cross-org settings');
select tests.clear_authentication();
select is((select count(*) from public.cart_contact_actions),:'before_actions'::bigint,'cross-org wrote no actions');
select is((select count(*) from public.contact_channel_permissions),:'before_perms'::bigint,'cross-org wrote no permissions');
select is((select contact_blocked_at from public.contacts where id=:'ck1'),null,'cross-org blocked nobody');

-- 4. unsafe link: bloqueado, sem telefone, sem mensagem, sem registro.
select pg_temp.cart(:'conn','k4a','k4a@ex.com','http://allowed.host/r/k4a') as k4a \gset
select pg_temp.cart(:'conn','k4b','k4b@ex.com','javascript:alert(1)//https://allowed.host/') as k4b \gset
select pg_temp.cart(:'conn','k4c','k4c@ex.com','https://evil.com/r/k4c') as k4c \gset
select pg_temp.grant_perm(:'k4a',:'ug'), pg_temp.grant_perm(:'k4b',:'ug'), pg_temp.grant_perm(:'k4c',:'ug');
select tests.authenticate_as(:'ug');
select is(public.prepare_cart_whatsapp(:'oa',:'k4a','rk-4a'),'{"blocked":"Link de retomada indisponível"}'::jsonb,'http link blocked');
select is(public.prepare_cart_whatsapp(:'oa',:'k4b','rk-4b'),'{"blocked":"Link de retomada indisponível"}'::jsonb,'javascript link blocked');
select is(public.prepare_cart_whatsapp(:'oa',:'k4c','rk-4c'),'{"blocked":"Link de retomada indisponível"}'::jsonb,'unlisted host blocked');
select tests.clear_authentication();
select is((select count(*)::int from public.cart_contact_actions where cart_id in (:'k4a',:'k4b',:'k4c')),0,'blocked prepare records nothing');

-- 5. pago entre preparar e confirmar.
select pg_temp.cart(:'conn','k5','k5@ex.com','https://allowed.host/r/k5') as k5 \gset
select pg_temp.grant_perm(:'k5',:'ug');
select tests.authenticate_as(:'ug');
select ok(public.prepare_cart_whatsapp(:'oa',:'k5','rk-5-open') ? 'phone','prepare ok before payment');
select tests.clear_authentication();
select is(pg_temp.paid(:'conn','o5','tok-k5','k5@ex.com'),'processed','order.paid ingested');
select tests.authenticate_as(:'ug');
select throws_ok(format($$select public.record_cart_action(%L,%L,'marked_sent','rk-5-sent',null,false)$$,:'oa',:'k5'),
  'P0001','Pagamento confirmado','marked_sent after payment fails with block reason');

-- 6. mesma request_key.
select public.record_cart_action(:'oa',:'k1','marked_sent','rk-sent-1',null,false) as s1 \gset
select is(public.record_cart_action(:'oa',:'k1','marked_sent','rk-sent-1',null,false)->>'id',(:'s1'::jsonb)->>'id','same key and content returns existing');
select throws_ok(format($$select public.record_cart_action(%L,%L,'marked_sent','rk-sent-1','outra nota',false)$$,:'oa',:'k1'),
  '22023','idempotency_conflict','same key with different content conflicts');
select throws_ok(format($$select public.record_cart_action(%L,%L,'note','rk-open-1','Uma nota',false)$$,:'oa',:'k1'),
  '22023','idempotency_conflict','key reused across actions conflicts');
select tests.clear_authentication();
select is(pg_temp.n_actions(:'k1','marked_sent'),1,'one marked_sent');
select is((select recovery_stage||'/'||(last_contact_at is not null) from public.store_carts where id=:'k1'),'waiting_reply/true','marked_sent sets stage and last contact');

-- 7. repetição exige confirmação.
select tests.authenticate_as(:'ug');
select throws_ok(format($$select public.record_cart_action(%L,%L,'marked_sent','rk-sent-2',null,false)$$,:'oa',:'k1'),
  'P0001','repeat_confirmation_required','second send needs repeat');
select lives_ok(format($$select public.record_cart_action(%L,%L,'marked_sent','rk-sent-2',null,true)$$,:'oa',:'k1'),'repeat confirmed records');
select tests.clear_authentication();
select is(pg_temp.n_actions(:'k1','marked_sent'),2,'two marked_sent');

-- 8. sem opened_whatsapp anterior.
select pg_temp.cart(:'conn','k8','k8@ex.com','https://allowed.host/r/k8') as k8 \gset
select pg_temp.grant_perm(:'k8',:'ug');
select tests.authenticate_as(:'ug');
select throws_ok(format($$select public.record_cart_action(%L,%L,'marked_sent','rk-8',null,false)$$,:'oa',:'k8'),
  'P0001','open_whatsapp_required','marked_sent requires prior open');

-- 9. pausa, retomada, encerramento, e-mails interrompidos só no carrinho.
select tests.clear_authentication();
select pg_temp.cart(:'conn','k9a','nine@ex.com','https://allowed.host/r/k9a') as k9a \gset
select pg_temp.cart(:'conn','k9b','nine@ex.com','https://allowed.host/r/k9b') as k9b \gset
select pg_temp.grant_perm(:'k9a',:'ug');
select pg_temp.contact(:'k9a') as ck9 \gset
select is(pg_temp.sends(:'k9a'),'scheduled/-','cart 9a has scheduled e-mails');
select tests.authenticate_as(:'ug');
select throws_ok(format($$select public.record_cart_action(%L,%L,'paused','rk-9p0',null,false)$$,:'oa',:'k9a'),'22023',null,'pause without note rejected');
select throws_ok(format($$select public.record_cart_action(%L,%L,'paused','rk-9p1','ok',false)$$,:'oa',:'k9a'),'22023',null,'pause note too short');
select throws_ok(format($$select public.record_cart_action(%L,%L,'note','rk-9n1','veja https://evil.com',false)$$,:'oa',:'k9a'),'22023',null,'note with URL rejected');
select throws_ok(format($$select public.record_cart_action(%L,%L,'note','rk-9n2','a senha password é 123',false)$$,:'oa',:'k9a'),'22023',null,'note with secret word rejected');
select throws_ok(format($$select public.record_cart_action(%L,%L,'bogus','rk-9b',null,false)$$,:'oa',:'k9a'),'22023',null,'unknown action rejected');
select lives_ok(format($$select public.record_cart_action(%L,%L,'paused','rk-9p2','Cliente pediu um tempo',false)$$,:'oa',:'k9a'),'pause with note');

select is(public.get_store_cart(:'oa',:'k9a')->>'blockReason','Atendimento pausado','detail shows pause reason');
select lives_ok(format($$select public.record_cart_action(%L,%L,'resumed','rk-9r',null,false)$$,:'oa',:'k9a'),'resume');
select is(public.get_store_cart(:'oa',:'k9a')->>'blockReason',null,'resumed is eligible');
select lives_ok(format($$select public.record_cart_action(%L,%L,'closed','rk-9c',null,false)$$,:'oa',:'k9a'),'close');
select is(public.get_store_cart(:'oa',:'k9a')->>'blockReason','Atendimento encerrado','closed blocks');
select lives_ok(format($$select public.record_cart_action(%L,%L,'reopened','rk-9o',null,false)$$,:'oa',:'k9a'),'reopen');
select is((select recovery_stage||'/'||(closed_at is null) from public.store_carts where id=:'k9a'),'new/true','reopened -> new');
select lives_ok(format($$select public.record_cart_action(%L,%L,'emails_stopped','rk-9e',null,false)$$,:'oa',:'k9a'),'stop e-mails');
select tests.clear_authentication();
select is(pg_temp.sends(:'k9a'),'cancelled/paused_by_operator','cart e-mails cancelled by operator');
select is(pg_temp.sends(:'k9b'),'scheduled/-','other cart of same contact keeps e-mails');

-- 12b. bloquear contato cancela e-mails agendados do contato.
select tests.authenticate_as(:'ug');
select throws_ok(format($$select public.set_contact_blocked(%L,%L,true,null)$$,:'oa',:'ck9'),'22023',null,'block requires reason');
select lives_ok(format($$select public.set_contact_blocked(%L,%L,true,'Pediu para não receber')$$,:'oa',:'ck9'),'agent blocks contact');
select tests.clear_authentication();
select is(pg_temp.sends(:'k9b'),'cancelled/unsubscribed','blocking cancels contact e-mails');
select is(private.cart_whatsapp_block_reason(:'k9a'),'Cliente bloqueado para contato','blocked contact');
select tests.authenticate_as(:'ug');
select lives_ok(format($$select public.set_contact_blocked(%L,%L,false,null)$$,:'oa',:'ck9'),'agent unblocks contact');
select tests.clear_authentication();
select is((select coalesce(contact_blocked_at::text,'-')||coalesce(contact_blocked_reason,'-') from public.contacts where id=:'ck9'),'--','unblocked');

-- 10. lista: filtros, paginação, pagamento não reconciliado.
select pg_temp.cart(:'conn','k10','ten@ex.com',null,'+5521999990000') as k10 \gset
select pg_temp.paid(:'conn','o10',null,'ten@ex.com');
select count(*)::int as n_carts from public.store_carts where organization_id=:'oa' \gset
select count(*)::int as n_eligible from public.store_carts where organization_id=:'oa' and private.cart_whatsapp_block_reason(id) is null \gset
select tests.authenticate_as(:'uv');
select is((public.list_store_carts(:'oa','{}',1,100)->>'total')::int,:'n_carts'::int,'total counts all carts');
select is(jsonb_array_length(public.list_store_carts(:'oa','{}',2,3)->'rows'),3,'page size respected');
select is((public.list_store_carts(:'oa','{}',2,3)->>'total')::int,:'n_carts'::int,'total independent of page');
select throws_ok(format($$select public.list_store_carts(%L,'{}',1,101)$$,:'oa'),'22023',null,'page size 101 rejected');
select throws_ok(format($$select public.list_store_carts(%L,'{}',0,10)$$,:'oa'),'22023',null,'page 0 rejected');
select is(public.list_store_carts(:'oa','{"commercialStatus":"paid"}',1,20)->'rows'->0->>'id',:'k5','commercialStatus filter');
select is((public.list_store_carts(:'oa','{"commercialStatus":"paid"}',1,20)->>'total')::int,1,'commercialStatus filter total');
select is((public.list_store_carts(:'oa','{"eligible":true}',1,100)->>'total')::int,:'n_eligible'::int,'eligible filter');
select ok(not exists(select 1 from jsonb_array_elements(public.list_store_carts(:'oa','{"eligible":true}',1,100)->'rows') r
  where r->>'blockReason' is not null),'eligible rows have no block reason');
select is(public.list_store_carts(:'oa','{"q":"99999"}',1,20)->'rows'->0->>'id',:'k10','q by phone');
select is((public.list_store_carts(:'oa','{"q":"99999"}',1,20)->>'total')::int,1,'q by phone total');
select is((public.list_store_carts(:'oa','{"recoveryStage":"waiting_reply"}',1,20)->>'total')::int,1,'recoveryStage filter');
select is(public.list_store_carts(:'oa','{"q":"99999"}',1,20)->'rows'->0->'unreconciledPayment','true'::jsonb,'unreconciled payment flagged');
select is(public.list_store_carts(:'oa','{"q":"ana@ex.com"}',1,20)->'rows'->0->'unreconciledPayment','false'::jsonb,'no unreconciled payment');
select is(public.list_store_carts(:'oa','{"q":"ana@ex.com"}',1,20)->'rows'->0->>'itemsCount','3','items count sums quantities');
select is((public.list_store_carts(:'oa',jsonb_build_object('from',now()+interval '1 day'),1,20)->>'total')::int,0,'from filter');
select is((public.list_store_carts(:'oa',jsonb_build_object('to',now()+interval '1 day'),1,100)->>'total')::int,:'n_carts'::int,'to filter');

-- 11. detalhe sem URL nem telefone completo.
select public.get_store_cart(:'oa',:'k1') as d1 \gset
select ok(position('allowed.host/r/k1' in :'d1')=0,'detail hides recovery_url');
select ok(position('987654321' in :'d1')=0,'detail hides full phone');
select is((:'d1'::jsonb)->'contact'->>'phone','+55 11 9****-4321','masked phone');
select is((:'d1'::jsonb)->'recoveryUrlAllowed','true'::jsonb,'recoveryUrlAllowed');
select is((:'d1'::jsonb)->'permission'->>'status','granted','current permission');
select is((:'d1'::jsonb)->'actions'->0->>'actorName','Agente Bia','action with operator name');
select is(jsonb_array_length((:'d1'::jsonb)->'actions'),4,'all manual actions listed');
select is(jsonb_array_length((:'d1'::jsonb)->'emails'),(select count(*)::int from public.email_sends where cart_id=:'k1'),'e-mails of the cart listed');
select tests.clear_authentication();

select * from finish();
rollback;
