begin;
-- E-mails da loja: configurações, reserva/conclusão dos envios, supressão, descadastro, resultados e cron.
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.cart(p_conn uuid,p_ext text,p_email text,p_name text) returns uuid
language sql as $$
  select public.ingest_yampi_event(p_conn,jsonb_build_object('kind','cart','event','cart.reminder','merchantAlias','loja',
    'customer',jsonb_build_object('email',p_email,'name',p_name,'phone',null),
    'cart',jsonb_build_object('externalId',p_ext,'token','tok-'||p_ext,'total',150,'recoveryUrl','https://loja.test/r/'||p_ext,
      'items',jsonb_build_array(jsonb_build_object('name','Terço','quantity',1,'price',150)))),'hash-'||p_ext||'-'||p_email);
  select id from public.store_carts where connection_id=p_conn and external_id=p_ext;
$$;
-- Deixa vencido o envio do passo p_pos do carrinho e devolve o id.
create function pg_temp.due(p_cart uuid,p_pos int) returns uuid
language sql as $$
  update public.email_sends e set send_at=now()-interval '1 minute' from public.email_journey_steps s
    where s.id=e.step_id and e.cart_id=p_cart and s.position=p_pos returning e.id;
$$;
create function pg_temp.reason(p_send uuid) returns text
language sql as $$ select state||'/'||coalesce(cancel_reason,'') from public.email_sends where id=p_send $$;

select tests.create_user('owner62@t.test','Owner') as ua \gset
select tests.create_user('agent62@t.test','Agent') as ub \gset
select tests.create_user('other62@t.test','Other') as uc \gset
select tests.create_org(:'ua','Org62') as oa \gset
select tests.create_org(:'uc','Org62b') as ob \gset
select tests.add_member(:'oa',:'ub','agent');

select tests.authenticate_as(:'ua');
select public.save_store_connection(:'oa','loja','s3cr3t') as conn \gset
select public.set_email_journey_enabled(:'oa','cart',true) as journey \gset
select tests.clear_authentication();
select id as step1 from public.email_journey_steps where journey_id=:'journey' and position=1 \gset
select id as step2 from public.email_journey_steps where journey_id=:'journey' and position=2 \gset

-- 1. Sem configurações → no_settings.
select pg_temp.cart(:'conn','c0','zed@ex.com','Zed') as c0 \gset
select pg_temp.due(:'c0',1) as s0 \gset
select is(public.claim_email_sends(10),'[]'::jsonb,'nothing valid without settings');
select is(pg_temp.reason(:'s0'),'cancelled/no_settings','no settings cancels with no_settings');

-- 2. Configurações: só admin; segredos fora do alcance do usuário.
select tests.authenticate_as(:'ub');
select throws_ok(format('select public.save_email_settings(%L,%L)',:'oa','{"fromName":"X","fromEmail":"x@ex.com"}'),'42501',null,'non-admin cannot save email settings');
select tests.authenticate_as(:'ua');
select public.save_email_settings(:'oa','{"fromName":"Loja Santa","fromEmail":"Loja@Ex.com","replyTo":"sac@ex.com","resendKey":"re_123","resendWebhookSecret":"whsec_1"}');
select public.save_email_settings(:'oa','{"fromName":"Loja Santa","fromEmail":"loja@ex.com","replyTo":"sac@ex.com"}');
select is((select from_email from public.email_settings where organization_id=:'oa'),'loja@ex.com','member reads settings');
select throws_ok('select resend_key_secret_id from public.email_settings','42501',null,'secret ids not exposed');
select throws_ok(format('select public.read_email_settings_secret(%L)',:'oa'),'42501',null,'authenticated cannot read the resend key');
select tests.clear_authentication();
select is(public.read_email_settings_secret(:'oa'),
  jsonb_build_object('resendKey','re_123','fromName','Loja Santa','fromEmail','loja@ex.com','replyTo','sac@ex.com'),
  'absent keys keep the stored secrets');
select is(public.read_resend_webhook_secrets(),jsonb_build_array(jsonb_build_object('organizationId',:'oa','secret','whsec_1')),'webhook secrets listed');
select public.record_email_domain_status(:'oa','verified');
select is((select domain_status from public.email_settings where organization_id=:'oa'),'verified','domain status recorded');
select throws_ok(format('select public.record_email_domain_status(%L,%L)',:'oa','bogus'),'22023',null,'invalid domain status rejected');

-- 3. Reserva: devolve o vencido e o passa a sending; não devolve de novo.
select pg_temp.cart(:'conn','c1','ana@ex.com','Ana Maria Souza') as c1 \gset
select pg_temp.due(:'c1',1) as s1 \gset
select public.claim_email_sends(10) as claim1 \gset
select is(jsonb_array_length(:'claim1'::jsonb),1,'claim returns the due send');
select is((:'claim1'::jsonb)->0->>'sendId',:'s1','claim returns the send id');
select is((:'claim1'::jsonb)->0->>'toEmail','ana@ex.com','claim returns the recipient');
select is((:'claim1'::jsonb)->0->>'from','Loja Santa <loja@ex.com>','claim returns the sender');
select is((:'claim1'::jsonb)->0->>'replyTo','sac@ex.com','claim returns reply-to');
select is((:'claim1'::jsonb)->0->>'resendKey','re_123','claim returns the resend key');
select is((:'claim1'::jsonb)->0->>'category','marketing','claim returns the category');
select is(((:'claim1'::jsonb)->0->'ctx')-'unsubscribeToken'::text,jsonb_build_object('storeName','Loja Santa','firstName','Ana','name','Ana Maria Souza',
  'total',150,'items',jsonb_build_array(jsonb_build_object('name','Terço','quantity',1,'price',150)),'buttonUrl','https://loja.test/r/c1'),'claim ctx');
select ok(length((:'claim1'::jsonb)->0->'ctx'->>'unsubscribeToken')=48,'marketing send carries an unsubscribe token');
select is((:'claim1'::jsonb)->0->'content'->>'coupon',null,'blank coupon is null');
select is((:'claim1'::jsonb)->0->'content'->>'buttonLabel','Finalizar minha compra','content has the button label');
select is(pg_temp.reason(:'s1'),'sending/','claimed send is sending');
select is(public.claim_email_sends(10),'[]'::jsonb,'immediate second claim returns nothing');
update public.email_sends set claimed_at=now()-interval '6 minutes' where id=:'s1';
select is(public.claim_email_sends(10)->0->>'sendId',:'s1','send stuck in sending for 6 min is claimed again');
select is(public.claim_email_sends(0),'[]'::jsonb,'limit 0 claims nothing');

-- 4. Destinatário atual: e-mail trocado no contato e contato trocado no carrinho.
update public.contacts set email='ana.nova@ex.com' where email='ana@ex.com';
select pg_temp.due(:'c1',2) as s2 \gset
select is(public.claim_email_sends(10)->0->>'toEmail','ana.nova@ex.com','claim uses the contact current e-mail');
select is((select to_email from public.email_sends where id=:'s2'),'ana.nova@ex.com','send to_email updated');
select pg_temp.cart(:'conn','c1','bea@ex.com','Bea') as c1b \gset
select pg_temp.due(:'c1',3) as s3 \gset
update public.email_journey_steps set coupon='VOLTA10' where journey_id=:'journey' and position=3;
select public.claim_email_sends(10) as claim3 \gset
select is((:'claim3'::jsonb)->0->>'toEmail','bea@ex.com','claim follows the cart current contact');
select is((:'claim3'::jsonb)->0->'content'->>'coupon','VOLTA10','coupon returned');
select is((select contact_id from public.email_sends where id=:'s3'),(select contact_id from public.store_carts where id=:'c1'),'send contact follows the cart');
update public.email_journey_steps set coupon='' where journey_id=:'journey' and position=3;

-- 5. Cancelamentos na reserva.
select pg_temp.cart(:'conn','c2','bia@ex.com','Bia') as c2 \gset
select pg_temp.due(:'c2',1) as sx \gset
select tests.authenticate_as(:'ua');
select public.save_email_journey_step(:'oa',:'step1','{"enabled":false}');
select tests.clear_authentication();
select is(public.claim_email_sends(10),'[]'::jsonb,'disabled step not returned');
select is(pg_temp.reason(:'sx'),'cancelled/step_disabled','disabled step → step_disabled');
select tests.authenticate_as(:'ua');
select public.save_email_journey_step(:'oa',:'step1','{"enabled":true}');
select tests.clear_authentication();

select pg_temp.cart(:'conn','c3','caio@ex.com','Caio') as c3 \gset
select pg_temp.due(:'c3',1) as sx \gset
insert into public.store_orders(organization_id,connection_id,external_id,number,contact_id,total,paid_at)
  select :'oa',:'conn','o3','N3',contact_id,150,now() from public.store_carts where id=:'c3';
select is(public.claim_email_sends(10),'[]'::jsonb,'paid contact not returned');
select is(pg_temp.reason(:'sx'),'cancelled/paid','paid order → paid');

select pg_temp.cart(:'conn','c4','dani@ex.com','Dani') as c4 \gset
select pg_temp.due(:'c4',1) as sx \gset
update public.store_carts set converted_at=now() where id=:'c4';
select public.claim_email_sends(10);
select is(pg_temp.reason(:'sx'),'cancelled/converted','converted cart → converted');

select pg_temp.cart(:'conn','c5','eva@ex.com','Eva') as c5 \gset
select pg_temp.due(:'c5',1) as sx \gset
update public.contacts set email_marketing_opt_out_at=now() where email='eva@ex.com';
select public.claim_email_sends(10);
select is(pg_temp.reason(:'sx'),'cancelled/unsubscribed','opted-out contact → unsubscribed (marketing)');

select pg_temp.cart(:'conn','c6','fabio@ex.com','Fabio') as c6 \gset
select pg_temp.due(:'c6',1) as sx \gset
insert into public.email_suppressions(organization_id,email,reason) values(:'oa','fabio@ex.com','bounced');
select public.claim_email_sends(10);
select is(pg_temp.reason(:'sx'),'cancelled/suppressed','suppressed address → suppressed');

select pg_temp.cart(:'conn','c7','gil@ex.com','Gil') as c7 \gset
select pg_temp.due(:'c7',1) as sx \gset
update public.contacts set email='  ' where email='gil@ex.com';
select public.claim_email_sends(10);
select is(pg_temp.reason(:'sx'),'cancelled/no_email','blank contact e-mail → no_email');

select pg_temp.cart(:'conn','c8','hel@ex.com','Hel') as c8 \gset
select pg_temp.due(:'c8',1) as sx \gset
update public.store_carts set recovery_url=null where id=:'c8';
select public.claim_email_sends(10);
select is(pg_temp.reason(:'sx'),'cancelled/no_recovery_url','cart without recovery url → no_recovery_url');

select pg_temp.cart(:'conn','c9','ivo@ex.com','Ivo') as c9 \gset
select pg_temp.due(:'c9',3) as sx \gset
select public.claim_email_sends(10);
select is(pg_temp.reason(:'sx'),'cancelled/no_coupon','{cupom} with blank coupon → no_coupon');

-- 6. Conclusão: sent; retry ×3 reagenda 5/15/60 min; a 4ª vira failed.
select public.complete_email_send(:'s1','sent','prov-1',null);
select is(pg_temp.reason(:'s1'),'sent/','sent recorded');
select ok((select sent_at is not null and provider_id='prov-1' from public.email_sends where id=:'s1'),'sent_at and provider id stored');
select public.complete_email_send(:'s2','retry',null,'rate_limited');
select is((select state||'/'||attempts||'/'||(send_at-now()) from public.email_sends where id=:'s2'),'scheduled/1/00:05:00','1st retry in 5 min');
update public.email_sends set state='sending' where id=:'s2';
select public.complete_email_send(:'s2','retry',null,'rate_limited');
select is((select state||'/'||attempts||'/'||(send_at-now()) from public.email_sends where id=:'s2'),'scheduled/2/00:15:00','2nd retry in 15 min');
update public.email_sends set state='sending' where id=:'s2';
select public.complete_email_send(:'s2','retry',null,'rate_limited');
select is((select state||'/'||attempts||'/'||(send_at-now()) from public.email_sends where id=:'s2'),'scheduled/3/01:00:00','3rd retry in 60 min');
update public.email_sends set state='sending' where id=:'s2';
select public.complete_email_send(:'s2','retry',null,'rate_limited');
select is((select state||'/'||attempts||'/'||error_code from public.email_sends where id=:'s2'),'failed/4/rate_limited','4th retry fails');
select throws_ok(format('select public.complete_email_send(%L,%L,null,null)',:'s2','bogus'),'22023',null,'invalid result rejected');

-- 7. Eventos do provedor.
select public.record_email_event('prov-1','email.delivered','2026-11-01 10:00+00');
select public.record_email_event('prov-1','email.delivered','2026-11-02 10:00+00');
select is((select delivered_at from public.email_sends where id=:'s1'),'2026-11-01 10:00+00'::timestamptz,'first delivery kept');
select public.record_email_event('prov-1','email.opened','2026-11-01 11:00+00');
select ok((select opened_at is not null from public.email_sends where id=:'s1'),'opened stamped');
select public.record_email_event('prov-1','email.bounced','2026-11-01 12:00+00');
select is((select reason from public.email_suppressions where organization_id=:'oa' and email='ana@ex.com'),'bounced','bounce suppresses the address');
select ok((select bounced_at is not null from public.email_sends where id=:'s1'),'bounced stamped');

-- 8. Descadastro.
select pg_temp.cart(:'conn','c10','jo@ex.com','Jo') as c10 \gset
select pg_temp.due(:'c10',1) as sx \gset
select public.claim_email_sends(10)->0->'ctx'->>'unsubscribeToken' as tok \gset
select ok(has_function_privilege('anon','public.unsubscribe_email(text)','execute'),'anon can unsubscribe');
set local role anon;
select is(public.unsubscribe_email(:'tok'),true,'valid token unsubscribes');
select is(public.unsubscribe_email('nope'),false,'unknown token returns false');
reset role;
select ok((select email_marketing_opt_out_at is not null from public.contacts where email='jo@ex.com'),'contact opted out');
select is((select array_agg(distinct state||'/'||cancel_reason) from public.email_sends where cart_id=:'c10' and state<>'sending'),
  array['cancelled/unsubscribed'],'scheduled marketing sends cancelled');

-- 9. Resultados: pago 3 dias depois do 2º envio conta para o 2º; 8 dias depois não conta.
select pg_temp.cart(:'conn','c11','kim@ex.com','Kim') as c11 \gset
update public.email_sends e set state='sent', sent_at=now()-interval '10 days'
  from public.email_journey_steps s where s.id=e.step_id and e.cart_id=:'c11' and s.position=1;
update public.email_sends e set state='sent', sent_at=now()-interval '5 days'
  from public.email_journey_steps s where s.id=e.step_id and e.cart_id=:'c11' and s.position=2;
insert into public.store_orders(organization_id,connection_id,external_id,number,contact_id,total,paid_at)
  select :'oa',:'conn','o11','N11',contact_id,99.5,now()-interval '2 days' from public.store_carts where id=:'c11';
select pg_temp.cart(:'conn','c12','lia@ex.com','Lia') as c12 \gset
update public.email_sends e set state='sent', sent_at=now()-interval '20 days'
  from public.email_journey_steps s where s.id=e.step_id and e.cart_id=:'c12' and s.position=1;
update public.email_sends e set state='sent', sent_at=now()-interval '12 days'
  from public.email_journey_steps s where s.id=e.step_id and e.cart_id=:'c12' and s.position=2;
insert into public.store_orders(organization_id,connection_id,external_id,number,contact_id,total,paid_at)
  select :'oa',:'conn','o12','N12',contact_id,500,now()-interval '4 days' from public.store_carts where id=:'c12';
select tests.authenticate_as(:'ub');
select public.email_journey_results(:'oa',now()-interval '30 days',now()+interval '1 day') as res \gset
select tests.clear_authentication();
select is((select e->'recoveredOrders' from jsonb_array_elements(:'res'::jsonb) e where e->>'stepId'=:'step2'),'1'::jsonb,'order paid 3 days after 2nd send counts for step 2');
select is((select e->'recoveredTotal' from jsonb_array_elements(:'res'::jsonb) e where e->>'stepId'=:'step2'),'99.5'::jsonb,'recovered total for step 2');
select is((select e->'recoveredOrders' from jsonb_array_elements(:'res'::jsonb) e where e->>'stepId'=:'step1'),'0'::jsonb,'not attributed to step 1');
select is((select (e->'cancelled'->>'no_settings')::int from jsonb_array_elements(:'res'::jsonb) e where e->>'stepId'=:'step1'),1,'cancellations counted by reason');
select ok((select (e->>'sent')::int>=3 and (e->>'delivered')::int=1 and (e->>'opened')::int=1
  from jsonb_array_elements(:'res'::jsonb) e where e->>'stepId'=:'step1'),'sent/delivered/opened counted');
-- 9b. Só jornadas cart/pending_payment recuperam vendas; post_purchase nunca.
insert into public.email_journeys(organization_id,kind,enabled) values(:'oa','post_purchase',true) returning id as pp \gset
insert into public.email_journey_steps(organization_id,journey_id,position,delay_minutes,subject,body,button_label,category)
  values(:'oa',:'pp',1,60,'Obrigado','Obrigado','Ver pedido','transactional') returning id as ppstep \gset
select pg_temp.cart(:'conn','c13','mia@ex.com','Mia') as c13 \gset
update public.email_sends e set state='sent', sent_at=now()-interval '6 days'
  from public.email_journey_steps s where s.id=e.step_id and e.cart_id=:'c13' and s.position=1;
insert into public.email_sends(organization_id,contact_id,step_id,to_email,send_at,state,sent_at)
  select :'oa',contact_id,:'ppstep','mia@ex.com',now(),'sent',now()-interval '4 days' from public.store_carts where id=:'c13';
insert into public.store_orders(organization_id,connection_id,external_id,number,contact_id,total,paid_at)
  select :'oa',:'conn','o13','N13',contact_id,10,now()-interval '3 days' from public.store_carts where id=:'c13';
insert into public.contacts(organization_id,name,email) values(:'oa','Noa','noa@ex.com') returning id as noa \gset
insert into public.email_sends(organization_id,contact_id,step_id,to_email,send_at,state,sent_at)
  values(:'oa',:'noa',:'ppstep','noa@ex.com',now(),'sent',now()-interval '2 days');
insert into public.store_orders(organization_id,connection_id,external_id,number,contact_id,total,paid_at)
  values(:'oa',:'conn','o14','N14',:'noa',20,now()-interval '1 day');
select tests.authenticate_as(:'ub');
select public.email_journey_results(:'oa',now()-interval '30 days',now()+interval '1 day') as res \gset
select tests.clear_authentication();
select is((select e->'recoveredOrders' from jsonb_array_elements(:'res'::jsonb) e where e->>'stepId'=:'step1'),'1'::jsonb,'order after a later post_purchase send is credited to the cart send');
select is((select e->'recoveredOrders' from jsonb_array_elements(:'res'::jsonb) e where e->>'stepId'=:'ppstep'),'0'::jsonb,'post_purchase sends never recover orders');

select tests.authenticate_as(:'uc');
select throws_ok(format('select public.email_journey_results(%L,now()-interval ''1 day'',now())',:'oa'),'42501',null,'non-member cannot read results');

-- 10. Permissões e cron.
select tests.authenticate_as(:'ub');
select throws_ok('select public.claim_email_sends(10)','42501',null,'authenticated cannot claim sends');
select throws_ok(format('select public.complete_email_send(%L,%L,null,null)',:'s1','sent'),'42501',null,'authenticated cannot complete sends');
select throws_ok('select count(*) from public.email_unsubscribe_tokens','42501',null,'tokens not readable');
select tests.clear_authentication();
select ok(not has_function_privilege('authenticated','public.dispatch_email_worker()','execute'),'dispatch is not for users');
select is((select schedule from cron.job where jobname='flowai-email-worker'),'* * * * *','cron every minute');

select * from finish();
rollback;
