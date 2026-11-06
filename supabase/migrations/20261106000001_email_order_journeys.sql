-- E-mails da loja (etapas 2 e 3): Pix/boleto pendente e pós-venda.
-- Pedidos passam a guardar vencimento e links; os passos ganham um tipo de agendamento;
-- a entrada da Yampi agenda/cancela as três jornadas e a reserva monta o contexto do pedido.

alter table public.store_orders
  add column due_at timestamptz,
  add column public_url text,
  add column payment_url text;

alter table public.email_journey_steps
  add column timing text not null default 'delay' check (timing in ('delay','due_date','on_tracking'));

-- Confirmação de compra sai no mesmo instante (0 minuto).
alter table public.email_journey_steps
  drop constraint email_journey_steps_delay_minutes_check;
alter table public.email_journey_steps
  add constraint email_journey_steps_delay_minutes_check check (delay_minutes between 0 and 43200);

-- Um envio por passo e pedido; o par (passo, carrinho) já existe para o carrinho.
alter table public.email_sends
  add constraint email_sends_step_order_key unique (step_id, order_id);
create index email_sends_order_idx on public.email_sends (order_id);

-- ---------------------------------------------------------------- jornadas
-- Primeira ativação cria os passos padrão da jornada. Os textos e esperas espelham
-- DEFAULT_CART_STEPS / DEFAULT_PENDING_PAYMENT_STEPS / DEFAULT_POST_PURCHASE_STEPS em
-- packages/core/src/email/template.ts.
create or replace function public.set_email_journey_enabled(p_org uuid, p_kind text, p_enabled boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_created boolean;
begin
  if not public.has_role(p_org,'admin') then raise exception 'forbidden' using errcode='42501'; end if;
  if p_kind not in ('cart','pending_payment','post_purchase') then
    raise exception 'invalid journey' using errcode='22023';
  end if;
  insert into public.email_journeys(organization_id,kind,enabled) values(p_org,p_kind,coalesce(p_enabled,false))
    on conflict (organization_id,kind) do update set enabled=excluded.enabled
    returning id, (xmax=0) into v_id, v_created;
  if v_created and p_kind='cart' then
    insert into public.email_journey_steps(organization_id,journey_id,position,delay_minutes,timing,subject,heading,body,button_label,coupon,category) values
      (p_org,v_id,1,60,'delay','{primeiro_nome}, seu carrinho está guardado','{primeiro_nome}, deixamos seu carrinho guardado',
        'Você escolheu peças com carinho na {loja}. Elas continuam esperando por você, é só voltar e finalizar quando puder.',
        'Finalizar minha compra','','marketing'),
      (p_org,v_id,2,1440,'delay','{primeiro_nome}, suas peças ainda estão aqui','{primeiro_nome}, ainda dá tempo',
        'Passando para lembrar que seu carrinho segue reservado na {loja}. Se ficou alguma dúvida, é só responder este e-mail.',
        'Finalizar minha compra','','marketing'),
      (p_org,v_id,3,2880,'delay','{primeiro_nome}, um presente para finalizar sua compra','{primeiro_nome}, um presente para você',
        'Para ajudar você a concluir seu pedido, use o cupom {cupom} no checkout da {loja}. Que suas peças cheguem com bênção.',
        'Finalizar minha compra','','marketing');
  elsif v_created and p_kind='pending_payment' then
    insert into public.email_journey_steps(organization_id,journey_id,position,delay_minutes,timing,subject,heading,body,button_label,coupon,category) values
      (p_org,v_id,1,120,'delay','{primeiro_nome}, falta confirmar seu pagamento','{primeiro_nome}, seu pedido está esperando',
        'Recebemos seu pedido {numero_pedido} na {loja}, mas o pagamento ainda não foi confirmado. Se o Pix ou o boleto venceu, é só gerar de novo pelo link abaixo.',
        'Pagar meu pedido','','marketing'),
      (p_org,v_id,2,0,'due_date','{primeiro_nome}, seu pagamento vence hoje','Último dia para pagar',
        'O prazo do seu pedido {numero_pedido} termina hoje. Pague pelo link abaixo para garantir suas peças na {loja}.',
        'Pagar meu pedido','','marketing');
  elsif v_created and p_kind='post_purchase' then
    insert into public.email_journey_steps(organization_id,journey_id,position,delay_minutes,timing,subject,heading,body,button_label,coupon,category) values
      (p_org,v_id,1,0,'delay','Pedido {numero_pedido} confirmado','Obrigado, {primeiro_nome}!',
        'Seu pagamento foi confirmado e já estamos preparando seu pedido na {loja}. Você recebe o código de rastreio por aqui assim que ele estiver disponível.',
        'Ver meu pedido','','transactional'),
      (p_org,v_id,2,0,'on_tracking','Seu pedido {numero_pedido} foi enviado','Seu pedido está a caminho',
        'Boa notícia! Seu pedido já saiu da {loja}. O código de rastreio é {rastreio}. Acompanhe pelo link abaixo.',
        'Rastrear pedido','','transactional'),
      (p_org,v_id,3,21600,'delay','{primeiro_nome}, como foi sua compra?','Queremos saber o que você achou',
        'Já faz alguns dias que seu pedido chegou. Conte para a gente como foi a experiência e volte para conhecer as novidades da {loja}.',
        'Ver novidades','','marketing');
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- entrada Yampi
create or replace function public.ingest_yampi_event(p_connection uuid, p_event jsonb, p_body_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_conn public.store_connections;
  v_kind text := p_event->>'kind';
  v_res jsonb := case p_event->>'kind' when 'cart' then p_event->'cart' when 'order' then p_event->'order' end;
  v_email text := lower(btrim(p_event->'customer'->>'email'));
  v_contact uuid;
  v_cart public.store_carts;
  v_order public.store_orders;
  v_paid boolean := coalesce((p_event->'order'->>'paid')::boolean,false);
  v_tz text;
  v_due date;
  v_due_at timestamptz;
begin
  if p_connection is null or coalesce(p_event->>'event','')='' or coalesce(p_body_hash,'')='' then
    raise exception 'invalid store event' using errcode='22023';
  end if;
  select * into v_conn from public.store_connections where id=p_connection;
  if not found then raise exception 'unknown store connection' using errcode='22023'; end if;

  insert into public.store_events(organization_id,connection_id,event,resource_id,body_hash)
    values(v_conn.organization_id,v_conn.id,p_event->>'event',coalesce(v_res->>'externalId',''),p_body_hash)
    on conflict do nothing;
  if not found then return jsonb_build_object('state','duplicate'); end if;
  if v_kind not in ('cart','order') or coalesce(v_res->>'externalId','')='' or coalesce(v_email,'')='' then
    return jsonb_build_object('state','ignored');
  end if;

  v_contact := private.contact_for_email(v_conn.organization_id,v_email,p_event->'customer'->>'name',p_event->'customer'->>'phone');
  select coalesce(o.timezone,'America/Sao_Paulo') into v_tz from public.organizations o where o.id=v_conn.organization_id;

  if v_kind='cart' then
    -- pedido que chegou antes do carrinho (pago primeiro)
    if v_res->>'token' is not null then
      select * into v_order from public.store_orders o
        where o.connection_id=v_conn.id and o.cart_token=v_res->>'token'
        order by o.paid_at is not null desc, o.updated_at desc limit 1;
    end if;
    insert into public.store_carts(organization_id,connection_id,external_id,token,contact_id,total,shipping,recovery_url,items,converted_at,
        abandoned_at,order_id,commercial_status)
      values(v_conn.organization_id,v_conn.id,v_res->>'externalId',v_res->>'token',v_contact,
        coalesce((v_res->>'total')::numeric,0),(v_res->>'shipping')::numeric,v_res->>'recoveryUrl',coalesce(v_res->'items','[]'::jsonb),
        -- pedido que chegou antes do carrinho já o converte
        case when v_order.id is not null then now() end,
        (v_res->>'abandonedAt')::timestamptz,v_order.id,
        case when v_order.id is null then 'abandoned'
          else private.cart_commercial_status('abandoned',v_order.paid_at is not null,v_order.status_alias) end)
      on conflict (connection_id,external_id) do update set token=excluded.token, contact_id=excluded.contact_id,
        total=excluded.total, shipping=excluded.shipping, recovery_url=excluded.recovery_url, items=excluded.items,
        converted_at=coalesce(public.store_carts.converted_at,excluded.converted_at),
        abandoned_at=coalesce(public.store_carts.abandoned_at,excluded.abandoned_at),
        order_id=coalesce(public.store_carts.order_id,excluded.order_id),
        -- pago nunca reabre, mesmo se o pedido foi apagado (order_id null)
        commercial_status=case when public.store_carts.commercial_status='paid' or public.store_carts.order_id is not null
          then public.store_carts.commercial_status else excluded.commercial_status end
      returning * into v_cart;
    if v_cart.converted_at is null
       and not exists(select 1 from public.email_sends where cart_id=v_cart.id) then
      insert into public.email_sends(organization_id,contact_id,step_id,cart_id,to_email,send_at)
        select v_conn.organization_id,v_contact,s.id,v_cart.id,v_email,now()+make_interval(mins=>s.delay_minutes)
        from public.email_journeys j join public.email_journey_steps s on s.journey_id=j.id
        where j.organization_id=v_conn.organization_id and j.kind='cart' and j.enabled and s.enabled
        on conflict (step_id,cart_id) do nothing;
    end if;
    return jsonb_build_object('state','processed');
  end if;

  insert into public.store_orders(organization_id,connection_id,external_id,number,contact_id,status_alias,payment_alias,
      total,cart_token,items,paid_at,track_code,track_url,due_at,public_url,payment_url)
    values(v_conn.organization_id,v_conn.id,v_res->>'externalId',coalesce(v_res->>'number',v_res->>'externalId'),v_contact,
      v_res->>'statusAlias',v_res->>'paymentAlias',coalesce((v_res->>'total')::numeric,0),v_res->>'cartToken',
      coalesce(v_res->'items','[]'::jsonb),case when v_paid then now() end,v_res->>'trackCode',v_res->>'trackUrl',
      (v_res->>'dueAt')::timestamptz,v_res->>'publicUrl',v_res->>'paymentUrl')
    on conflict (connection_id,external_id) do update set number=excluded.number, contact_id=excluded.contact_id,
      status_alias=excluded.status_alias, payment_alias=excluded.payment_alias, total=excluded.total,
      cart_token=coalesce(excluded.cart_token,public.store_orders.cart_token), items=excluded.items,
      paid_at=coalesce(public.store_orders.paid_at,excluded.paid_at),
      track_code=coalesce(excluded.track_code,public.store_orders.track_code),
      track_url=coalesce(excluded.track_url,public.store_orders.track_url),
      due_at=coalesce(excluded.due_at,public.store_orders.due_at),
      public_url=coalesce(excluded.public_url,public.store_orders.public_url),
      payment_url=coalesce(excluded.payment_url,public.store_orders.payment_url)
    returning * into v_order;

  -- token gravado no pedido: o evento de pagamento pode vir sem cartToken
  if v_order.cart_token is not null then
    with converted as (
      update public.store_carts set converted_at=coalesce(converted_at,now()),
        -- carrinho pago mantém o pedido que o pagou
        order_id=case when commercial_status='paid' then coalesce(order_id,v_order.id) else v_order.id end,
        commercial_status=private.cart_commercial_status(commercial_status,v_order.paid_at is not null,v_order.status_alias)
      where connection_id=v_conn.id and token=v_order.cart_token returning id)
    update public.email_sends set state='cancelled', cancel_reason='converted'
      where state='scheduled' and cart_id in (select id from converted);
  end if;

  if v_order.paid_at is not null then
    -- Pagamento encerra lembretes de carrinho e de Pix/boleto do contato.
    update public.email_sends e set state='cancelled', cancel_reason='paid'
      from public.email_journey_steps s join public.email_journeys j on j.id=s.journey_id
      where e.step_id=s.id and j.kind in ('cart','pending_payment') and e.contact_id=v_contact and e.state='scheduled';

    -- Pós-venda: confirmação e recompra contam do pagamento; rastreio só quando o código existe.
    -- Num evento posterior (ex.: status.updated já pago), só o passo de rastreio pode entrar: os
    -- passos por tempo não são reenviados nem preenchidos retroativamente.
    insert into public.email_sends(organization_id,contact_id,step_id,order_id,to_email,send_at)
      select v_conn.organization_id,v_contact,s.id,v_order.id,v_email,x.send_at
      from public.email_journeys j
      join public.email_journey_steps s on s.journey_id=j.id
      cross join lateral (
        select case
          when s.timing='delay' then coalesce(v_order.paid_at,now())+make_interval(mins=>s.delay_minutes)
          when s.timing='on_tracking' and nullif(btrim(coalesce(v_order.track_code,'')),'') is not null
            then now()+make_interval(mins=>s.delay_minutes)
        end as send_at) x
      where j.organization_id=v_conn.organization_id and j.kind='post_purchase' and j.enabled and s.enabled
        and (v_paid or s.timing='on_tracking')
        and x.send_at is not null
      on conflict (step_id,order_id) do nothing;
  else
    -- Pix/boleto pendente: lembrete após o pedido e, se houver boleto, no dia do vencimento às 09:00 da loja.
    v_due := case when v_order.due_at is null then null else (v_order.due_at at time zone v_tz)::date end;
    v_due_at := case when v_due is null then null else ((v_due + time '09:00') at time zone v_tz) end;
    if v_due_at is not null and v_due_at <= now() then
      v_due_at := case when v_due >= (now() at time zone v_tz)::date then now()+interval '1 minute' else null end;
    end if;

    insert into public.email_sends(organization_id,contact_id,step_id,order_id,to_email,send_at)
      select v_conn.organization_id,v_contact,s.id,v_order.id,v_email,x.send_at
      from public.email_journeys j
      join public.email_journey_steps s on s.journey_id=j.id
      cross join lateral (
        select case
          when s.timing='delay' then now()+make_interval(mins=>s.delay_minutes)
          when s.timing='due_date' then v_due_at
        end as send_at) x
      where j.organization_id=v_conn.organization_id and j.kind='pending_payment' and j.enabled and s.enabled
        and x.send_at is not null
      on conflict (step_id,order_id) do nothing;
  end if;
  return jsonb_build_object('state','processed');
end $$;

-- ---------------------------------------------------------------- reserva
create or replace function public.claim_email_sends(p_limit int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  e public.email_sends;
  s public.email_journey_steps;
  j public.email_journeys;
  c public.store_carts;
  o public.store_orders;
  k public.contacts;
  st public.email_settings;
  v_contact uuid;
  v_email text;
  v_key text;
  v_coupon text;
  v_token text;
  v_reason text;
  v_button text;
  v_total numeric;
  v_items jsonb;
  v_number text;
  v_track text;
  v_btn text;
begin
  if coalesce(p_limit,0)<=0 then return v_out; end if;
  for v_id in
    select id from public.email_sends
    where (state='scheduled' and send_at<=now()) or (state='sending' and claimed_at<now()-interval '5 minutes')
    order by send_at for update skip locked
  loop
    select * into e from public.email_sends where id=v_id;
    select * into s from public.email_journey_steps where id=e.step_id;
    select * into j from public.email_journeys where id=s.journey_id;
    select * into c from public.store_carts where id=e.cart_id;
    select * into o from public.store_orders where id=e.order_id;
    v_contact := coalesce(o.contact_id,c.contact_id,e.contact_id);
    select * into k from public.contacts where id=v_contact;
    select * into st from public.email_settings where organization_id=e.organization_id;
    select decrypted_secret into v_key from vault.decrypted_secrets where id=st.resend_key_secret_id;
    v_email := lower(nullif(btrim(k.email),''));
    v_coupon := nullif(btrim(s.coupon),'');
    v_total := case when e.order_id is not null then o.total else c.total end;
    v_items := case when e.order_id is not null then o.items else c.items end;
    v_number := o.number;
    v_track := nullif(btrim(o.track_code),'');
    v_btn := case j.kind
      when 'cart' then nullif(btrim(c.recovery_url),'')
      when 'pending_payment' then coalesce(nullif(btrim(o.payment_url),''),nullif(btrim(o.public_url),''))
      when 'post_purchase' then case when s.timing='on_tracking'
        then coalesce(nullif(btrim(o.track_url),''),nullif(btrim(o.public_url),''))
        else coalesce(nullif(btrim(o.public_url),''),nullif(btrim(o.payment_url),'')) end
    end;
    v_button := v_btn;

    v_reason := case
      when not j.enabled or not s.enabled then 'step_disabled'
      when j.kind='cart' and exists(select 1 from public.store_orders x
        where x.organization_id=e.organization_id and x.contact_id=v_contact and x.paid_at>=e.created_at) then 'paid'
      when j.kind='pending_payment' and o.paid_at is not null then 'paid'
      when j.kind='cart' and c.converted_at is not null then 'converted'
      when k.contact_blocked_at is not null then 'unsubscribed'
      when s.category='marketing' and k.email_marketing_opt_out_at is not null then 'unsubscribed'
      when v_email is null then 'no_email'
      when exists(select 1 from public.email_suppressions x
        where x.organization_id=e.organization_id and lower(x.email)=v_email) then 'suppressed'
      when v_button is null then case when j.kind='cart' then 'no_recovery_url' else 'no_link' end
      when v_coupon is null and concat_ws(' ',s.subject,s.heading,s.body) like '%{cupom}%' then 'no_coupon'
      when st.organization_id is null or coalesce(v_key,'')='' then 'no_settings'
    end;
    if v_reason is not null then
      update public.email_sends set state='cancelled', cancel_reason=v_reason, claimed_at=null where id=v_id;
      continue;
    end if;

    v_token := null;
    if s.category='marketing' then
      insert into public.email_unsubscribe_tokens(organization_id,contact_id) values(e.organization_id,v_contact)
        on conflict (contact_id) do nothing;
      select token into v_token from public.email_unsubscribe_tokens where contact_id=v_contact;
    end if;
    update public.email_sends set state='sending', claimed_at=now(), contact_id=v_contact, to_email=v_email where id=v_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'sendId',v_id, 'toEmail',v_email, 'category',s.category,
      'content',jsonb_build_object('subject',s.subject,'heading',s.heading,'body',s.body,'buttonLabel',s.button_label,'coupon',v_coupon),
      'ctx',jsonb_build_object('storeName',st.from_name,'firstName',nullif(split_part(btrim(coalesce(k.name,'')),' ',1),''),
        'name',k.name,'total',v_total,'items',v_items,'buttonUrl',v_button,
        'orderNumber',v_number,'trackingCode',v_track,'unsubscribeToken',v_token),
      'from',st.from_name||' <'||st.from_email||'>', 'replyTo',st.reply_to, 'resendKey',v_key));
    exit when jsonb_array_length(v_out)>=p_limit;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------- resultados
-- A jornada acompanha cada passo no painel (as posições se repetem entre jornadas).
create or replace function public.email_journey_results(p_org uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_out jsonb;
begin
  if not public.is_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  with sends as (
    select * from public.email_sends where organization_id=p_org and created_at>=p_from and created_at<p_to
  ), counts as (
    select step_id, count(*) scheduled, count(sent_at) sent, count(delivered_at) delivered,
      count(opened_at) opened, count(clicked_at) clicked
    from sends group by step_id
  ), cancels as (
    select step_id, jsonb_object_agg(reason,n) obj
    from (select step_id, coalesce(cancel_reason,'unknown') reason, count(*) n from sends where state='cancelled' group by 1,2) t
    group by step_id
  ), recovered as (
    select x.step_id, count(*) n, sum(o.total) total
    from public.store_orders o
    cross join lateral (
      select e.step_id, e.created_at from public.email_sends e
      join public.email_journey_steps s on s.id=e.step_id
      join public.email_journeys j on j.id=s.journey_id and j.kind in ('cart','pending_payment')
      where e.organization_id=p_org and e.contact_id=o.contact_id
        and e.sent_at<=o.paid_at and e.sent_at>o.paid_at-interval '7 days'
      order by e.sent_at desc limit 1) x
    where o.organization_id=p_org and o.paid_at is not null and x.created_at>=p_from and x.created_at<p_to
    group by x.step_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('stepId',s.id,'kind',j.kind,'position',s.position,
      'scheduled',coalesce(n.scheduled,0),'sent',coalesce(n.sent,0),'delivered',coalesce(n.delivered,0),
      'opened',coalesce(n.opened,0),'clicked',coalesce(n.clicked,0),'cancelled',coalesce(c.obj,'{}'::jsonb),
      'recoveredOrders',coalesce(r.n,0),'recoveredTotal',coalesce(r.total,0)) order by j.kind, s.position),'[]'::jsonb)
  into v_out
  from public.email_journey_steps s join public.email_journeys j on j.id=s.journey_id
  left join counts n on n.step_id=s.id left join cancels c on c.step_id=s.id left join recovered r on r.step_id=s.id
  where s.organization_id=p_org;
  return v_out;
end $$;
