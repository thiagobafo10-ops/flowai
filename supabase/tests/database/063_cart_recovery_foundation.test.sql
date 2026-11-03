begin;
-- Recuperação unificada: estado comercial do carrinho, autorizações, bloqueios e histórico manual.
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.cart(p_conn uuid,p_ext text,p_token text,p_email text,p_abandoned text,p_url text,p_hash text) returns uuid
language sql as $$
  select public.ingest_yampi_event(p_conn,jsonb_build_object('kind','cart','event','cart.reminder','merchantAlias','loja',
    'customer',jsonb_build_object('email',p_email,'name','Cliente '||p_ext,'phone','+5511987654321'),
    'cart',jsonb_build_object('externalId',p_ext,'token',p_token,'total',99.9,'recoveryUrl',p_url,'abandonedAt',p_abandoned,
      'items',jsonb_build_array(jsonb_build_object('name','Terço','quantity',1,'price',99.9)))),p_hash);
  select id from public.store_carts where connection_id=p_conn and external_id=p_ext;
$$;
create function pg_temp.ord(p_conn uuid,p_event text,p_ext text,p_cart_token text,p_email text,p_paid boolean,p_alias text,p_hash text) returns text
language sql as $$
  select public.ingest_yampi_event(p_conn,jsonb_build_object('kind','order','event',p_event,'merchantAlias','loja',
    'customer',jsonb_build_object('email',p_email,'name','Cliente','phone',null),
    'order',jsonb_build_object('externalId',p_ext,'number','N'||p_ext,'statusAlias',p_alias,'paymentAlias','pix','total',99.9,
      'cartToken',p_cart_token,'paid',p_paid,'items','[]'::jsonb,'trackCode',null,'trackUrl',null)),p_hash)->>'state'
$$;
create function pg_temp.st(p_cart uuid) returns text
language sql as $$ select commercial_status from public.store_carts where id=p_cart $$;
create function pg_temp.perm(p_cart uuid,p_status text,p_by uuid) returns void
language sql as $$
  insert into public.contact_channel_permissions(organization_id,contact_id,channel,status,source,evidence_at,recorded_by)
    select organization_id,contact_id,'whatsapp',p_status,'Conversa no Instagram',now(),p_by from public.store_carts where id=p_cart;
$$;
-- Carrinho totalmente elegível: telefone válido, autorização granted, host autorizado, abandoned.
create function pg_temp.eligible(p_conn uuid,p_ext text,p_by uuid) returns uuid
language plpgsql as $$
declare v uuid;
begin
  v := pg_temp.cart(p_conn,p_ext,'tok-'||p_ext,p_ext||'@ex.com',null,'https://allowed.host/r/'||p_ext,'hash-'||p_ext);
  perform pg_temp.perm(v,'granted',p_by);
  return v;
end $$;
create function pg_temp.reason(p_cart uuid) returns text
language sql as $$ select private.cart_whatsapp_block_reason(p_cart) $$;
create function pg_temp.with_url(p_cart uuid,p_url text) returns text
language sql as $$
  update public.store_carts set recovery_url=p_url where id=p_cart;
  select private.cart_whatsapp_block_reason(p_cart);
$$;

select tests.create_user('owner63@t.test','Owner') as ua \gset
select tests.create_user('viewer63@t.test','Viewer') as uv \gset
select tests.create_user('other63@t.test','Other') as uc \gset
select tests.create_org(:'ua','Org63') as oa \gset
select tests.create_org(:'uc','Org63b') as ob \gset
select tests.add_member(:'oa',:'uv','viewer');

select tests.authenticate_as(:'ua');
select public.save_store_connection(:'oa','loja','s3cr3t') as conn \gset
select public.set_email_journey_enabled(:'oa','cart',true) as journey \gset
select tests.clear_authentication();
update public.store_connections set checkout_hosts='{allowed.host}' where id=:'conn';

-- 1. abandoned_at gravado uma vez e nunca sobrescrito.
select pg_temp.cart(:'conn','c1','tk1','ana@ex.com','2026-11-01T10:00:00.000Z','https://allowed.host/r/c1','h1') as c1 \gset
select is((select abandoned_at from public.store_carts where id=:'c1'),'2026-11-01T10:00:00Z'::timestamptz,'abandoned_at stored');
select is((select commercial_status||'/'||recovery_stage from public.store_carts where id=:'c1'),'abandoned/new','new cart is abandoned/new');
select pg_temp.cart(:'conn','c1','tk1','ana@ex.com','2026-11-02T10:00:00.000Z','https://allowed.host/r/c1','h1b');
select is((select abandoned_at from public.store_carts where id=:'c1'),'2026-11-01T10:00:00Z'::timestamptz,'second reminder keeps abandoned_at');

-- 2. Pedido pelo cart_token aguardando pagamento.
select is(pg_temp.ord(:'conn','order.created','o1','tk1','ana@ex.com',false,'waiting_payment','h2'),'processed','order processed');
select is((select order_id from public.store_carts where id=:'c1'),(select id from public.store_orders where external_id='o1'),'order associated by cart_token');
select is(pg_temp.st(:'c1'),'payment_pending','waiting_payment -> payment_pending');

-- 3. Pago é definitivo.
select pg_temp.ord(:'conn','order.paid','o1','tk1','ana@ex.com',true,'paid','h3');
select is(pg_temp.st(:'c1'),'paid','order.paid -> paid');
select pg_temp.ord(:'conn','order.status.updated','o1','tk1','ana@ex.com',false,'cancelled','h4');
select is(pg_temp.st(:'c1'),'paid','later cancelled does not downgrade paid');

-- Cancelado e demais estados.
select pg_temp.cart(:'conn','c2','tk2','caio@ex.com',null,null,'h5') as c2 \gset
select pg_temp.ord(:'conn','order.status.updated','o2','tk2','caio@ex.com',false,'canceled','h6');
select is(pg_temp.st(:'c2'),'cancelled','canceled -> cancelled');
select pg_temp.cart(:'conn','c3','tk3','duda@ex.com',null,null,'h7') as c3 \gset
select pg_temp.ord(:'conn','order.created','o3','tk3','duda@ex.com',false,'created','h8');
select is(pg_temp.st(:'c3'),'order_created','other alias -> order_created');
select pg_temp.ord(:'conn','order.status.updated','o3','tk3','duda@ex.com',false,'waiting_payment','h9');
select pg_temp.ord(:'conn','order.status.updated','o3','tk3','duda@ex.com',false,'handling_products','h10');
select is(pg_temp.st(:'c3'),'payment_pending','other alias only promotes abandoned carts');

-- 4. paid before reminder.
select pg_temp.ord(:'conn','order.paid','o9','tk9','eva@ex.com',true,'paid','h11');
select pg_temp.cart(:'conn','c9','tk9','eva@ex.com',null,'https://allowed.host/r/c9','h12') as c9 \gset
select is(pg_temp.st(:'c9'),'paid','cart arriving after paid order is born paid');
select is((select order_id from public.store_carts where id=:'c9'),(select id from public.store_orders where external_id='o9'),'late cart gets the order');
select is((select count(*)::int from public.email_sends where cart_id=:'c9'),0,'paid-before-reminder cart schedules no e-mails');

-- 5. Pago do mesmo contato sem cart_token não marca o carrinho.
select pg_temp.cart(:'conn','c5','tk5','bia@ex.com',null,null,'h13') as c5 \gset
select pg_temp.ord(:'conn','order.paid','o5',null,'bia@ex.com',true,'paid','h14');
select is((select commercial_status||'/'||coalesce(order_id::text,'-') from public.store_carts where id=:'c5'),'abandoned/-','unreconciled payment does not mark cart paid');

-- Pagamento chega sem cartToken num pedido já associado: vale o cart_token gravado no pedido.
select pg_temp.cart(:'conn','ca','tka','fia@ex.com',null,'https://allowed.host/r/ca','h15') as ca \gset
select pg_temp.perm(:'ca','granted',:'ua');
select pg_temp.ord(:'conn','order.created','oa','tka','fia@ex.com',false,'waiting_payment','h16');
select pg_temp.ord(:'conn','order.paid','oa',null,'fia@ex.com',true,'paid','h17');
select is(pg_temp.st(:'ca'),'paid','paid event without cartToken uses the stored order cart_token');
select is(pg_temp.reason(:'ca'),'Pagamento confirmado','paid via stored cart_token blocks WhatsApp');

-- Carrinho pago cujo pedido sumiu (order_id null) não reabre com reminder tardio.
delete from public.store_orders where external_id='o9';
select is((select order_id from public.store_carts where id=:'c9'),null,'paid cart lost its order reference');
select pg_temp.cart(:'conn','c9','tk9','eva@ex.com',null,'https://allowed.host/r/c9','h18');
select is(pg_temp.st(:'c9'),'paid','late reminder never reopens a paid cart without order');

-- Pedido apagado: o carrinho perde só a referência.
delete from public.store_orders where external_id='o3';
select is((select order_id from public.store_carts where id=:'c3'),null,'deleted order sets order_id null');

-- 6. Motivos de bloqueio, na ordem.
select pg_temp.eligible(:'conn','e0',:'ua') as e0 \gset
select is(pg_temp.reason(:'e0'),null,'fully eligible cart has no block reason');
select is(private.cart_whatsapp_phone(:'e0'),'+5511987654321','valid phone returned');
select pg_temp.eligible(:'conn','e1',:'ua') as e1 \gset
update public.store_carts set commercial_status='paid', paused_at=now(), recovery_stage='closed' where id=:'e1';
select is(pg_temp.reason(:'e1'),'Pagamento confirmado','paid wins over everything');
select pg_temp.eligible(:'conn','e2',:'ua') as e2 \gset
update public.store_carts set recovery_stage='closed', paused_at=now() where id=:'e2';
select is(pg_temp.reason(:'e2'),'Atendimento encerrado','closed');
select pg_temp.eligible(:'conn','e3',:'ua') as e3 \gset
update public.store_carts set paused_at=now() where id=:'e3';
select is(pg_temp.reason(:'e3'),'Atendimento pausado','paused');
select pg_temp.eligible(:'conn','e4',:'ua') as e4 \gset
update public.contacts set contact_blocked_at=now(), contact_blocked_reason='Pediu para não receber'
  where id=(select contact_id from public.store_carts where id=:'e4');
select pg_temp.perm(:'e4','revoked',:'ua');
select is(pg_temp.reason(:'e4'),'Cliente bloqueado para contato','contact blocked');
select pg_temp.eligible(:'conn','e5',:'ua') as e5 \gset
select pg_temp.perm(:'e5','revoked',:'ua');
select is(pg_temp.reason(:'e5'),'WhatsApp bloqueado pelo cliente','revoked');
select pg_temp.cart(:'conn','e6','tok-e6','e6@ex.com',null,'https://allowed.host/r/e6','hash-e6') as e6 \gset
select is(pg_temp.reason(:'e6'),'Sem autorização de contato registrada','no permission');
select pg_temp.eligible(:'conn','e7',:'ua') as e7 \gset
update public.contacts set phone='11987654321', updated_at=now() where id=(select contact_id from public.store_carts where id=:'e7');
select is(pg_temp.reason(:'e7'),'Telefone ausente ou inválido','invalid phone');
select is(private.cart_whatsapp_phone(:'e7'),null,'invalid phone not returned');
select pg_temp.eligible(:'conn','e8',:'ua') as e8 \gset
update public.store_carts set recovery_url='http://allowed.host/r/e8' where id=:'e8';
select is(pg_temp.reason(:'e8'),'Link de retomada indisponível','http link');
select throws_ok(format('select private.cart_whatsapp_block_reason(%L)',gen_random_uuid()),'42501',null,'unknown cart is not eligible');

-- Link: host exato, sem credenciais nem porta.
select is(pg_temp.with_url(:'e8','https://ALLOWED.HOST/x'),null,'uppercase host accepted');
select is(pg_temp.with_url(:'e8','https://allowed.host./x'),null,'trailing dot accepted');
select is(pg_temp.with_url(:'e8','https://allowed.host?x=1'),null,'host without path accepted');
select is(pg_temp.with_url(:'e8','https://u:p@allowed.host/x'),'Link de retomada indisponível','userinfo rejected');
select is(pg_temp.with_url(:'e8','https://allowed.host:8443/x'),'Link de retomada indisponível','explicit port rejected');
select is(pg_temp.with_url(:'e8','https://allowed.host.evil.com/x'),'Link de retomada indisponível','suffix host rejected');
select is(pg_temp.with_url(:'e8','https://evil.com/allowed.host'),'Link de retomada indisponível','host in path rejected');
select is(pg_temp.with_url(:'e8','javascript:alert(1)//https://allowed.host/'),'Link de retomada indisponível','javascript rejected');
select is(pg_temp.with_url(:'e8',null),'Link de retomada indisponível','missing link');
update public.store_connections set checkout_hosts='{}' where id=:'conn';
select is(pg_temp.reason(:'e0'),'Link de retomada indisponível','empty host list allows no link');
update public.store_connections set checkout_hosts='{allowed.host}' where id=:'conn';

-- 7. A última autorização vale.
select pg_temp.perm(:'e0','revoked',:'ua');
select is(pg_temp.reason(:'e0'),'WhatsApp bloqueado pelo cliente','revoked after granted blocks');
select pg_temp.perm(:'e0','granted',:'ua');
select is(pg_temp.reason(:'e0'),null,'granted again is eligible');

-- 8. Bloqueio geral cancela e-mail de qualquer categoria com unsubscribed.
select pg_temp.cart(:'conn','b1','tok-b1','bloq@ex.com',null,'https://allowed.host/r/b1','hb1') as b1 \gset
update public.email_journey_steps set category='transactional' where journey_id=:'journey' and position=1;
update public.email_sends e set send_at=now()-interval '1 minute' from public.email_journey_steps s
  where s.id=e.step_id and e.cart_id=:'b1' and s.position=1 returning e.id as sb1 \gset
update public.contacts set contact_blocked_at=now() where id=(select contact_id from public.store_carts where id=:'b1');
select public.claim_email_sends(10);
select is((select state||'/'||cancel_reason from public.email_sends where id=:'sb1'),'cancelled/unsubscribed','blocked contact cancels with unsubscribed');

-- 9. RLS e escrita direta.
insert into public.cart_contact_actions(organization_id,cart_id,contact_id,actor_id,action,request_key,request_hash)
  select organization_id,id,contact_id,:'ua','marked_sent','rk1','rh1' from public.store_carts where id=:'e0';
insert into public.cart_recovery_settings(organization_id,whatsapp_template,updated_by) values(:'oa','Oi {primeiro_nome}! {link}',:'ua');
select throws_ok($$insert into public.cart_contact_actions(organization_id,cart_id,contact_id,actor_id,action,request_key,request_hash)
  select organization_id,cart_id,contact_id,actor_id,action,'rk1','rh2' from public.cart_contact_actions$$,'23505',null,'request_key unique per org');
select tests.authenticate_as(:'uv');
select is((select count(*)::int from public.cart_contact_actions),1,'viewer reads cart actions');
select ok((select count(*)::int from public.contact_channel_permissions)>0,'viewer reads permissions');
select is((select count(*)::int from public.cart_recovery_settings),1,'viewer reads settings');
select tests.authenticate_as(:'uc');
select is((select count(*)::int from public.cart_contact_actions),0,'other org reads no actions');
select is((select count(*)::int from public.contact_channel_permissions),0,'other org reads no permissions');
select is((select count(*)::int from public.cart_recovery_settings),0,'other org reads no settings');
select tests.authenticate_as(:'ua');
select throws_ok(format($$insert into public.cart_contact_actions(organization_id,cart_id,contact_id,actor_id,action,request_key,request_hash)
  values(%L,%L,(select contact_id from public.store_carts where id=%L),%L,'note','rk2','rh')$$,:'oa',:'e0',:'e0',:'ua'),'42501',null,'owner cannot insert actions directly');
select throws_ok(format($$insert into public.contact_channel_permissions(organization_id,contact_id,channel,status,source,evidence_at,recorded_by)
  values(%L,(select contact_id from public.store_carts where id=%L),'whatsapp','granted','abc',now(),%L)$$,:'oa',:'e0',:'ua'),'42501',null,'owner cannot insert permissions directly');
select throws_ok(format($$insert into public.cart_recovery_settings(organization_id,whatsapp_template) values(%L,'Oi tudo bem {link}')
  on conflict do nothing$$,:'ob'),'42501',null,'owner cannot insert settings directly');
select throws_ok(format($$update public.store_carts set commercial_status='paid' where id=%L$$,:'e0'),'42501',null,'owner cannot update carts directly');
select throws_ok(format($$update public.contacts set contact_blocked_at=now() where organization_id=%L$$,:'oa'),'42501',null,'owner cannot block contacts directly');
select tests.clear_authentication();

select * from finish();
rollback;
