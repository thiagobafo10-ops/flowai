begin;
-- E-mails da loja (etapas 2 e 3): jornadas de Pix/boleto pendente e pós-venda.
create extension if not exists pgtap with schema extensions;
select no_plan();

create function pg_temp.ord(p_conn uuid,p_event text,p_ext text,p_email text,p_paid boolean,p_due date,p_track text,p_hash text) returns text
language sql as $$
  select public.ingest_yampi_event(p_conn,jsonb_build_object('kind','order','event',p_event,'merchantAlias','loja',
    'customer',jsonb_build_object('email',p_email,'name','Ana Souza','phone',null),
    'order',jsonb_build_object('externalId',p_ext,'number','N'||p_ext,
      'statusAlias',case when p_paid then 'paid' else 'waiting_payment' end,
      'paymentAlias',case when p_due is null then 'pix' else 'billet' end,'total',199.9,'cartToken',null,
      'paid',p_paid,'items',jsonb_build_array(jsonb_build_object('name','Terço','quantity',1,'price',199.9)),
      'trackCode',p_track,'trackUrl',case when p_track is null then null else 'https://rastreio.test/'||p_track end,
      'publicUrl','https://loja.test/pedido/'||p_ext,'paymentUrl','https://loja.test/pagar/'||p_ext,
      'dueAt',case when p_due is null then null else (p_due::timestamp at time zone 'America/Sao_Paulo') end)),
    p_hash)->>'state'
$$;
-- Deixa vencido o envio da jornada/passo e devolve o id.
create function pg_temp.due(p_order uuid,p_kind text,p_pos int) returns uuid
language sql as $$
  update public.email_sends e set send_at=now()-interval '1 minute'
  from public.email_journey_steps s join public.email_journeys j on j.id=s.journey_id
  where s.id=e.step_id and j.kind=p_kind and e.order_id=p_order and s.position=p_pos
  returning e.id;
$$;
create function pg_temp.reason(p_send uuid) returns text
language sql as $$ select state||'/'||coalesce(cancel_reason,'') from public.email_sends where id=p_send $$;

select tests.create_user('owner69@t.test','Owner') as ua \gset
select tests.create_org(:'ua','Org69') as oa \gset

select tests.authenticate_as(:'ua');
select public.save_store_connection(:'oa','loja','s3cr3t') as conn \gset
select public.save_email_settings(:'oa','{"fromName":"Loja 69","fromEmail":"loja@ex.com","resendKey":"re_69","resendWebhookSecret":"whsec_69"}');
select public.set_email_journey_enabled(:'oa','pending_payment',true) as pending \gset
select public.set_email_journey_enabled(:'oa','post_purchase',true) as post \gset
select throws_ok(format($$select public.set_email_journey_enabled(%L,'bogus',true)$$, :'oa'),
  '22023', null, 'unknown journey kind rejected');
select tests.clear_authentication();

-- 1. Passos padrão de cada jornada.
select is((select array_agg(timing order by position) from public.email_journey_steps where journey_id=:'pending'),
  array['delay','due_date'],'pending journey has a delay and a due-date step');
select is((select array_agg(delay_minutes order by position) from public.email_journey_steps where journey_id=:'pending'),
  array[120,0],'pending steps: 2h reminder and due date');
select is((select array_agg(category order by position) from public.email_journey_steps where journey_id=:'pending'),
  array['marketing','marketing'],'pending journey is marketing');
select is((select array_agg(timing order by position) from public.email_journey_steps where journey_id=:'post'),
  array['delay','on_tracking','delay'],'post-purchase has confirmation, tracking and recompra');
select is((select array_agg(delay_minutes order by position) from public.email_journey_steps where journey_id=:'post'),
  array[0,0,21600],'post-purchase: immediate confirmation and 15 days');
select is((select array_agg(category order by position) from public.email_journey_steps where journey_id=:'post'),
  array['transactional','transactional','marketing'],'confirmation and tracking are transactional');
select is((select count(*)::int from public.email_journey_steps where journey_id=:'post'),3,'post-purchase journey gets 3 default steps');

select tests.authenticate_as(:'ua');
select is(public.set_email_journey_enabled(:'oa','pending_payment',true),:'pending'::uuid,'enabling pending again returns the same journey');
select tests.clear_authentication();
select is((select count(*)::int from public.email_journey_steps where journey_id=:'pending'),2,'re-enabling does not duplicate steps');

select throws_ok(format($$insert into public.email_journey_steps(organization_id,journey_id,position,delay_minutes,timing,subject,body,button_label,category)
  values(%L,%L,9,0,'bogus','Assunto','Texto','Botão','marketing')$$, :'oa', :'pending'),
  '23514', null, 'invalid timing rejected by the check constraint');

-- 2. Pedido pendente com boleto: lembrete em 2h e envio no vencimento às 09:00 locais.
select ((now() at time zone 'America/Sao_Paulo')::date + 3) as due_date \gset
select (((:due_date::date) + time '09:00') at time zone 'America/Sao_Paulo') as due_at \gset
select pg_temp.ord(:'conn','order.created','p1','bia@ex.com',false,:'due_date',null,'h1') as r1 \gset
select is(:'r1','processed','pending order processed');
select id as o1 from public.store_orders where connection_id=:'conn' and external_id='p1' \gset
select is((select number from public.store_orders where id=:'o1'),'Np1','order number stored');
select is((select count(*)::int from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'pending' and e.state='scheduled'),2,'pending order schedules 2 sends');
select is((select count(*)::int from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'post'),0,'no post-purchase e-mail before payment');
select ok((select abs(extract(epoch from (e.send_at-now()-interval '120 minutes')))<5
  from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'pending' and s.position=1),'first pending reminder in 2 hours');
select is((select e.send_at from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'pending' and s.position=2),:'due_at'::timestamptz,'due-date e-mail at 09:00 in the store timezone');

-- 3. Repetição do evento não duplica envios.
select pg_temp.ord(:'conn','order.created','p1','bia@ex.com',false,:'due_date',null,'h1b');
select is((select count(*)::int from public.email_sends where order_id=:'o1'),2,'second order event keeps 2 sends');

-- 4. Pagamento: cancela o pendente e agenda confirmação + recompra; rastreio espera o código.
select pg_temp.ord(:'conn','order.paid','p1','bia@ex.com',true,null,null,'h2') as r2 \gset
select is(:'r2','processed','paid order processed');
select is((select array_agg(distinct state||'/'||cancel_reason) from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'pending'),array['cancelled/paid'],'payment cancels pending sends');
select is((select array_agg(s.position order by s.position) from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'post' and e.state='scheduled'),array[1,3],'confirmation and recompra scheduled, tracking waits');
select ok((select e.send_at<=now() from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'post' and s.position=1),'confirmation is immediate');
select ok((select abs(extract(epoch from (e.send_at-now()-interval '15 days')))<5
  from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'post' and s.position=3),'recompra 15 days after payment');

-- 5. Evento posterior com rastreio agenda só o passo de rastreio (sem confirmação retroativa).
select pg_temp.ord(:'conn','order.status.updated','p1','bia@ex.com',false,null,'BR123','h3') as r3 \gset
select is(:'r3','processed','tracking status processed');
select is((select count(*)::int from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'post' and e.state='scheduled'),3,'tracking adds the third post-purchase send');
select ok((select e.send_at<=now() from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'post' and s.position=2),'tracking send goes out now');
select is((select count(*)::int from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'post' and s.position=1),1,'confirmation is not duplicated');
select is((select count(*)::int from public.email_sends e join public.email_journey_steps s on s.id=e.step_id
  where e.order_id=:'o1' and s.journey_id=:'post' and s.position=3),1,'recompra is not duplicated');

-- 6. Reserva do rastreio: contexto com número do pedido, código e link.
update public.email_sends set send_at=now()+interval '1 day' where order_id=:'o1' and state='scheduled';
select pg_temp.due(:'o1','post_purchase',2) as s_track \gset
select public.claim_email_sends(1) as c_track \gset
select is((:'c_track'::jsonb)->0->>'sendId',:'s_track','tracking send reserved');
select is((:'c_track'::jsonb)->0->>'category','transactional','tracking send is transactional');
select is((:'c_track'::jsonb)->0->'ctx'->>'orderNumber','Np1','ctx has the order number');
select is((:'c_track'::jsonb)->0->'ctx'->>'trackingCode','BR123','ctx has the tracking code');
select is((:'c_track'::jsonb)->0->'ctx'->>'buttonUrl','https://rastreio.test/BR123','tracking button uses the tracking link');

-- 7. Reserva de Pix pendente: botão é o link de pagamento do pedido.
select pg_temp.ord(:'conn','order.created','p2','caio@ex.com',false,:'due_date',null,'h4') as r4 \gset
select id as o2 from public.store_orders where connection_id=:'conn' and external_id='p2' \gset
update public.email_sends set send_at=now()+interval '1 day' where order_id=:'o2' and state='scheduled';
select pg_temp.due(:'o2','pending_payment',1) as s_pending \gset
select public.claim_email_sends(1) as c_pending \gset
select is((:'c_pending'::jsonb)->0->>'sendId',:'s_pending','pending send reserved');
select is((:'c_pending'::jsonb)->0->>'category','marketing','pending reminder is marketing');
select is((:'c_pending'::jsonb)->0->'ctx'->>'orderNumber','Np2','pending ctx has the order number');
select is((:'c_pending'::jsonb)->0->'ctx'->>'buttonUrl','https://loja.test/pagar/p2','pending button uses the payment link');

-- 8. Pix sem vencimento: só o lembrete; sem link, cancela como no_link.
select pg_temp.ord(:'conn','order.created','p3','dani@ex.com',false,null,null,'h5') as r5 \gset
select id as o3 from public.store_orders where connection_id=:'conn' and external_id='p3' \gset
select is((select count(*)::int from public.email_sends where order_id=:'o3'),1,'no due date schedules only the reminder');
update public.store_orders set payment_url=null, public_url=null where id=:'o3';
select pg_temp.due(:'o3','pending_payment',1) as s_nolink \gset
select public.claim_email_sends(10);
select is(pg_temp.reason(:'s_nolink'),'cancelled/no_link','order without link cancels as no_link');

-- 9. Resultados identificam a jornada e pós-venda nunca recupera venda.
select tests.authenticate_as(:'ua');
select public.email_journey_results(:'oa',now()-interval '30 days',now()+interval '1 day') as res \gset
select tests.clear_authentication();
select ok(exists(select 1 from jsonb_array_elements(:'res'::jsonb) e
  where e->>'kind'='post_purchase' and (e->>'position')::int=3),'results carry the journey kind');
select is((select e->'recoveredOrders' from jsonb_array_elements(:'res'::jsonb) e
  where e->>'kind'='post_purchase' and (e->>'position')::int=1),'0'::jsonb,'post-purchase never recovers orders');

-- 10. Jornadas novas nascem desligadas em outra organização.
select tests.create_user('other69@t.test','Other') as uc \gset
select tests.create_org(:'uc','Org69b') as ob \gset
select tests.authenticate_as(:'uc');
select public.set_email_journey_enabled(:'ob','pending_payment',false) as off \gset
select tests.clear_authentication();
select is((select enabled from public.email_journeys where id=:'off'),false,'pending journey starts disabled');
select is((select count(*)::int from public.email_journey_steps where journey_id=:'off'),2,'disabled journey still gets its default steps');

select * from finish();
rollback;
