-- Recuperação unificada (entrega 1): estado comercial do carrinho, atendimento manual por WhatsApp,
-- autorizações de contato e histórico. Escrita só por RPC; leitura por membros (RLS).

alter table public.store_carts
  add column abandoned_at timestamptz,
  add column order_id uuid,
  add column commercial_status text not null default 'abandoned'
    check (commercial_status in ('abandoned','order_created','payment_pending','paid','cancelled')),
  add column recovery_stage text not null default 'new'
    check (recovery_stage in ('new','contacted','waiting_reply','closed')),
  add column paused_at timestamptz,
  add column pause_reason text,
  add column closed_at timestamptz,
  add column last_contact_at timestamptz,
  add foreign key (organization_id, order_id) references public.store_orders (organization_id, id) on delete set null (order_id);

alter table public.store_connections add column checkout_hosts text[] not null default '{}';
grant select (checkout_hosts) on public.store_connections to authenticated;

alter table public.contacts
  add column contact_blocked_at timestamptz,
  add column contact_blocked_reason text;

create table public.contact_channel_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contact_id uuid not null,
  channel text not null check (channel = 'whatsapp'),
  status text not null check (status in ('granted','revoked')),
  source text not null check (char_length(source) between 3 and 240),
  evidence_at timestamptz not null,
  recorded_by uuid not null,
  -- clock_timestamp: a ordem de gravação decide a autorização vigente, mesmo dentro de uma transação
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade
);
create index contact_channel_permissions_latest_idx on public.contact_channel_permissions (contact_id, channel, created_at desc);

create table public.cart_contact_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  cart_id uuid not null,
  contact_id uuid not null,
  actor_id uuid not null,
  action text not null check (action in ('opened_whatsapp','marked_sent','reply_received','paused','resumed','closed','reopened','emails_stopped','note')),
  note text check (char_length(note) <= 2000),
  request_key text not null,
  request_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, request_key),
  foreign key (organization_id, cart_id) references public.store_carts (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade
);
create index cart_contact_actions_cart_idx on public.cart_contact_actions (cart_id, created_at);

create table public.cart_recovery_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  whatsapp_template text not null check (char_length(whatsapp_template) between 10 and 2000),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.contact_channel_permissions enable row level security;
alter table public.cart_contact_actions enable row level security;
alter table public.cart_recovery_settings enable row level security;
revoke all on public.contact_channel_permissions, public.cart_contact_actions, public.cart_recovery_settings
  from public, anon, authenticated;
grant select on public.contact_channel_permissions, public.cart_contact_actions, public.cart_recovery_settings to authenticated;
create policy contact_channel_permissions_member_select on public.contact_channel_permissions for select to authenticated using (public.is_member(organization_id));
create policy cart_contact_actions_member_select on public.cart_contact_actions for select to authenticated using (public.is_member(organization_id));
create policy cart_recovery_settings_member_select on public.cart_recovery_settings for select to authenticated using (public.is_member(organization_id));

-- ---------------------------------------------------------------- estado comercial
-- Pago é definitivo; aliases sem regra própria só promovem carrinho ainda abandonado.
create function private.cart_commercial_status(p_current text, p_paid boolean, p_alias text) returns text
language sql immutable set search_path='' as $$
  select case
    when p_current='paid' or p_paid then 'paid'
    when p_alias='waiting_payment' then 'payment_pending'
    when p_alias in ('cancelled','canceled') then 'cancelled'
    when p_current='abandoned' then 'order_created'
    else p_current
  end
$$;

-- Carrinhos já convertidos antes desta migração: associa o pedido (pago primeiro) pelo token.
update public.store_carts c set order_id=o.id,
  commercial_status=private.cart_commercial_status('abandoned',o.paid_at is not null,o.status_alias)
from public.store_orders o
where o.id=(select x.id from public.store_orders x where x.connection_id=c.connection_id and x.cart_token=c.token
  order by x.paid_at is not null desc, x.updated_at desc limit 1);

-- ---------------------------------------------------------------- elegibilidade WhatsApp
create function private.cart_whatsapp_phone(p_cart uuid) returns text
language sql stable security definer set search_path='' as $$
  select k.phone from public.store_carts c join public.contacts k on k.id=c.contact_id
  where c.id=p_cart and k.phone ~ '^\+55[1-9][0-9]9[0-9]{8}$'
$$;

-- Link: só https://, host (minúsculo, sem ponto final) igual a um checkout_hosts; credenciais ou porta explícita recusam.
create function private.checkout_url_allowed(p_url text, p_hosts text[]) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(a !~ '[@:]' and rtrim(lower(a),'.') = any(p_hosts), false)
  from (select substring(p_url from '^https://([^/?#]*)') as a) x
$$;

-- null = elegível; o primeiro motivo que casar vence.
create function private.cart_whatsapp_block_reason(p_cart uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare
  c public.store_carts;
  v_blocked timestamptz;
  v_hosts text[];
  v_perm text;
begin
  select * into c from public.store_carts where id=p_cart;
  if not found then raise exception 'cart not found' using errcode='42501'; end if;
  select contact_blocked_at into v_blocked from public.contacts where id=c.contact_id;
  select checkout_hosts into v_hosts from public.store_connections where id=c.connection_id;
  select status into v_perm from public.contact_channel_permissions
    where contact_id=c.contact_id and channel='whatsapp' order by created_at desc, id desc limit 1;
  return case
    when c.commercial_status='paid' then 'Pagamento confirmado'
    when c.recovery_stage='closed' then 'Atendimento encerrado'
    when c.paused_at is not null then 'Atendimento pausado'
    when v_blocked is not null then 'Cliente bloqueado para contato'
    when v_perm='revoked' then 'WhatsApp bloqueado pelo cliente'
    when v_perm is null then 'Sem autorização de contato registrada'
    when private.cart_whatsapp_phone(p_cart) is null then 'Telefone ausente ou inválido'
    when not private.checkout_url_allowed(c.recovery_url,v_hosts) then 'Link de retomada indisponível'
  end;
end $$;

-- ---------------------------------------------------------------- entrada Yampi
-- Cópia de 20261104000001 + abandoned_at, order_id e commercial_status.
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
    insert into public.store_carts(organization_id,connection_id,external_id,token,contact_id,total,recovery_url,items,converted_at,
        abandoned_at,order_id,commercial_status)
      values(v_conn.organization_id,v_conn.id,v_res->>'externalId',v_res->>'token',v_contact,
        coalesce((v_res->>'total')::numeric,0),v_res->>'recoveryUrl',coalesce(v_res->'items','[]'::jsonb),
        -- pedido que chegou antes do carrinho já o converte
        case when v_order.id is not null then now() end,
        (v_res->>'abandonedAt')::timestamptz,v_order.id,
        case when v_order.id is null then 'abandoned'
          else private.cart_commercial_status('abandoned',v_order.paid_at is not null,v_order.status_alias) end)
      on conflict (connection_id,external_id) do update set token=excluded.token, contact_id=excluded.contact_id,
        total=excluded.total, recovery_url=excluded.recovery_url, items=excluded.items,
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

-- ---------------------------------------------------------------- reserva de e-mails
-- Cópia de 20261104000004 + bloqueio geral do contato cancela com unsubscribed em qualquer categoria.
create or replace function public.claim_email_sends(p_limit int) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  e public.email_sends;
  s public.email_journey_steps;
  j public.email_journeys;
  c public.store_carts;
  k public.contacts;
  st public.email_settings;
  v_contact uuid;
  v_email text;
  v_key text;
  v_coupon text;
  v_token text;
  v_reason text;
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
    v_contact := coalesce(c.contact_id,e.contact_id);
    select * into k from public.contacts where id=v_contact;
    select * into st from public.email_settings where organization_id=e.organization_id;
    select decrypted_secret into v_key from vault.decrypted_secrets where id=st.resend_key_secret_id;
    v_email := lower(nullif(btrim(k.email),''));
    v_coupon := nullif(btrim(s.coupon),'');

    v_reason := case
      when not j.enabled or not s.enabled then 'step_disabled'
      when j.kind='cart' and exists(select 1 from public.store_orders o
        where o.organization_id=e.organization_id and o.contact_id=v_contact and o.paid_at>=e.created_at) then 'paid'
      when c.converted_at is not null then 'converted'
      when k.contact_blocked_at is not null then 'unsubscribed'
      when s.category='marketing' and k.email_marketing_opt_out_at is not null then 'unsubscribed'
      when v_email is null then 'no_email'
      when exists(select 1 from public.email_suppressions x
        where x.organization_id=e.organization_id and lower(x.email)=v_email) then 'suppressed'
      when nullif(btrim(c.recovery_url),'') is null then 'no_recovery_url'
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
        'name',k.name,'total',c.total,'items',c.items,'buttonUrl',c.recovery_url,'unsubscribeToken',v_token),
      'from',st.from_name||' <'||st.from_email||'>', 'replyTo',st.reply_to, 'resendKey',v_key));
    exit when jsonb_array_length(v_out)>=p_limit;
  end loop;
  return v_out;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function private.cart_commercial_status(text,boolean,text),
  private.cart_whatsapp_phone(uuid),
  private.checkout_url_allowed(text,text[]),
  private.cart_whatsapp_block_reason(uuid) from public,anon,authenticated;
