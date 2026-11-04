-- Frete do carrinho (totalizers.shipment da Yampi); nulo = não calculado ou carrinho anterior.

alter table public.store_carts add column shipping numeric(12,2);

-- Cópia de 20261105000001 + shipping.
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
      total,cart_token,items,paid_at,track_code,track_url)
    values(v_conn.organization_id,v_conn.id,v_res->>'externalId',coalesce(v_res->>'number',v_res->>'externalId'),v_contact,
      v_res->>'statusAlias',v_res->>'paymentAlias',coalesce((v_res->>'total')::numeric,0),v_res->>'cartToken',
      coalesce(v_res->'items','[]'::jsonb),case when v_paid then now() end,v_res->>'trackCode',v_res->>'trackUrl')
    on conflict (connection_id,external_id) do update set number=excluded.number, contact_id=excluded.contact_id,
      status_alias=excluded.status_alias, payment_alias=excluded.payment_alias, total=excluded.total,
      cart_token=coalesce(excluded.cart_token,public.store_orders.cart_token), items=excluded.items,
      paid_at=coalesce(public.store_orders.paid_at,excluded.paid_at),
      track_code=coalesce(excluded.track_code,public.store_orders.track_code),
      track_url=coalesce(excluded.track_url,public.store_orders.track_url)
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
  if v_paid then
    update public.email_sends e set state='cancelled', cancel_reason='paid'
      from public.email_journey_steps s join public.email_journeys j on j.id=s.journey_id
      where e.step_id=s.id and j.kind='cart' and e.contact_id=v_contact and e.state='scheduled';
  end if;
  return jsonb_build_object('state','processed');
end $$;

-- Cópia de 20261105000004 + shipping.
create or replace function public.get_store_cart(p_org uuid, p_cart uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  c public.store_carts;
  k public.contacts;
  v_hosts text[];
  v_phone text;
begin
  if not public.is_member(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into c from public.store_carts where id=p_cart and organization_id=p_org;
  if not found then raise exception 'cart not found' using errcode='42501'; end if;
  select * into k from public.contacts where id=c.contact_id;
  select checkout_hosts into v_hosts from public.store_connections where id=c.connection_id;
  v_phone := private.cart_whatsapp_phone(c.id);
  return jsonb_build_object(
    'id',c.id,'externalId',c.external_id,'total',c.total,'shipping',c.shipping,'items',c.items,
    'abandonedAt',c.abandoned_at,'receivedAt',c.created_at,'convertedAt',c.converted_at,
    'commercialStatus',c.commercial_status,'recoveryStage',c.recovery_stage,
    'pausedAt',c.paused_at,'pauseReason',c.pause_reason,'closedAt',c.closed_at,'lastContactAt',c.last_contact_at,
    'recoveryUrlAllowed',private.checkout_url_allowed(c.recovery_url,v_hosts),
    'unreconciledPayment',private.cart_unreconciled_payment(c.id),
    'blockReason',private.cart_whatsapp_block_reason(c.id),
    'contact',jsonb_build_object('id',k.id,'name',k.name,'email',k.email,
      'phone',case when v_phone is not null
        then '+55 '||substr(v_phone,4,2)||' '||substr(v_phone,6,1)||'****-'||right(v_phone,4)
        when char_length(k.phone)>=4 then '****'||right(k.phone,4) end,
      'phoneValid',v_phone is not null,'blockedAt',k.contact_blocked_at,'blockedReason',k.contact_blocked_reason),
    'permission',coalesce((select jsonb_build_object('status',p.status,'source',p.source,'evidenceAt',p.evidence_at,'recordedAt',p.created_at)
      from public.contact_channel_permissions p where p.contact_id=c.contact_id and p.channel='whatsapp'
      order by p.created_at desc, p.id desc limit 1),
      case when private.checkout_whatsapp_consent(p_org) then jsonb_build_object('status','granted','source','Checkout da Yampi',
        'evidenceAt',coalesce(c.abandoned_at,c.created_at),'recordedAt',c.created_at) end),
    'emails',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'stepPosition',s.position,'subject',s.subject,
        'state',e.state,'cancelReason',e.cancel_reason,'sendAt',e.send_at,'sentAt',e.sent_at,
        'deliveredAt',e.delivered_at,'openedAt',e.opened_at,'clickedAt',e.clicked_at,'bouncedAt',e.bounced_at)
        order by s.position, e.send_at)
      from public.email_sends e join public.email_journey_steps s on s.id=e.step_id where e.cart_id=c.id),'[]'),
    'actions',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'note',a.note,
        'actorName',pr.full_name,'createdAt',a.created_at) order by a.created_at, a.id)
      from public.cart_contact_actions a left join public.profiles pr on pr.id=a.actor_id where a.cart_id=c.id),'[]'));
end $$;
