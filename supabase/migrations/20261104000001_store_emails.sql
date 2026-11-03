-- E-mails da loja (etapa 1): conexão Yampi, eventos de carrinho/pedido, jornadas de e-mail e
-- agendamento da jornada de carrinho abandonado. Escrita só por RPC; leitura por membros (RLS).

alter table public.contacts add column email_marketing_opt_out_at timestamptz;
create index contacts_org_email_idx on public.contacts (organization_id, lower(btrim(email))) where email is not null;

create table public.store_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  merchant_alias text not null check (char_length(merchant_alias) between 1 and 200),
  webhook_secret_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.store_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  event text not null,
  resource_id text not null,
  body_hash text not null,
  received_at timestamptz not null default now(),
  unique (connection_id, event, resource_id, body_hash),
  foreign key (organization_id, connection_id) references public.store_connections (organization_id, id) on delete cascade
);

create table public.store_carts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  external_id text not null,
  token text,
  contact_id uuid not null,
  total numeric(12,2) not null default 0,
  recovery_url text,
  items jsonb not null default '[]'::jsonb,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id),
  unique (organization_id, id),
  foreign key (organization_id, connection_id) references public.store_connections (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade
);
create index store_carts_token_idx on public.store_carts (connection_id, token) where token is not null;

create table public.store_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  external_id text not null,
  number text not null,
  contact_id uuid not null,
  status_alias text,
  payment_alias text,
  total numeric(12,2) not null default 0,
  cart_token text,
  items jsonb not null default '[]'::jsonb,
  paid_at timestamptz,
  track_code text,
  track_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_id),
  unique (organization_id, id),
  foreign key (organization_id, connection_id) references public.store_connections (organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade
);
create index store_orders_cart_token_idx on public.store_orders (connection_id, cart_token) where cart_token is not null;

create table public.email_journeys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('cart','pending_payment','post_purchase')),
  enabled boolean not null default false,
  unique (organization_id, kind),
  unique (organization_id, id)
);

create table public.email_journey_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  journey_id uuid not null,
  position int not null check (position between 1 and 10),
  delay_minutes int not null check (delay_minutes between 1 and 43200),
  enabled boolean not null default true,
  subject text not null check (char_length(subject) between 1 and 150),
  heading text not null default '' check (char_length(heading) <= 150),
  body text not null check (char_length(body) between 1 and 3000),
  button_label text not null check (char_length(button_label) between 1 and 40),
  coupon text not null default '' check (char_length(coupon) <= 40),
  category text not null check (category in ('marketing','transactional')),
  unique (journey_id, position),
  unique (organization_id, id),
  foreign key (organization_id, journey_id) references public.email_journeys (organization_id, id) on delete cascade
);

create table public.email_sends (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contact_id uuid not null,
  step_id uuid not null,
  cart_id uuid,
  order_id uuid,
  to_email text not null,
  send_at timestamptz not null,
  state text not null default 'scheduled' check (state in ('scheduled','sending','sent','cancelled','failed')),
  cancel_reason text,
  claimed_at timestamptz,
  attempts int not null default 0,
  provider_id text unique,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  unique (step_id, cart_id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, step_id) references public.email_journey_steps (organization_id, id) on delete cascade,
  foreign key (organization_id, cart_id) references public.store_carts (organization_id, id) on delete cascade,
  foreign key (organization_id, order_id) references public.store_orders (organization_id, id) on delete cascade
);
create index email_sends_due_idx on public.email_sends (send_at) where state='scheduled';
create index email_sends_contact_scheduled_idx on public.email_sends (contact_id) where state='scheduled';
create index email_sends_cart_idx on public.email_sends (cart_id);

create table public.email_suppressions (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, email)
);

create trigger store_carts_set_updated_at before update on public.store_carts
  for each row execute function public.set_updated_at();
create trigger store_orders_set_updated_at before update on public.store_orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS
alter table public.store_connections enable row level security;
alter table public.store_events enable row level security;
alter table public.store_carts enable row level security;
alter table public.store_orders enable row level security;
alter table public.email_journeys enable row level security;
alter table public.email_journey_steps enable row level security;
alter table public.email_sends enable row level security;
alter table public.email_suppressions enable row level security;
revoke all on public.store_connections, public.store_events, public.store_carts, public.store_orders,
  public.email_journeys, public.email_journey_steps, public.email_sends, public.email_suppressions
  from public, anon, authenticated;
-- O id do segredo no Vault não é exposto.
grant select (id, organization_id, merchant_alias, created_at) on public.store_connections to authenticated;
grant select on public.store_events, public.store_carts, public.store_orders, public.email_journeys,
  public.email_journey_steps, public.email_sends, public.email_suppressions to authenticated;
create policy store_connections_member_select on public.store_connections for select to authenticated using (public.is_member(organization_id));
create policy store_events_member_select on public.store_events for select to authenticated using (public.is_member(organization_id));
create policy store_carts_member_select on public.store_carts for select to authenticated using (public.is_member(organization_id));
create policy store_orders_member_select on public.store_orders for select to authenticated using (public.is_member(organization_id));
create policy email_journeys_member_select on public.email_journeys for select to authenticated using (public.is_member(organization_id));
create policy email_journey_steps_member_select on public.email_journey_steps for select to authenticated using (public.is_member(organization_id));
create policy email_sends_member_select on public.email_sends for select to authenticated using (public.is_member(organization_id));
create policy email_suppressions_member_select on public.email_suppressions for select to authenticated using (public.is_member(organization_id));

-- ---------------------------------------------------------------- contatos
-- Casa só por e-mail (nunca por nome). O lock evita dois contatos para o mesmo e-mail em eventos simultâneos.
create function private.contact_for_email(p_org uuid, p_email text, p_name text, p_phone text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_email text := lower(btrim(p_email)); v_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contact-email:'||p_org||':'||v_email,0));
  select id into v_id from public.contacts
    where organization_id=p_org and lower(btrim(email))=v_email order by created_at, id limit 1;
  if v_id is null then
    insert into public.contacts(organization_id,name,email,phone) values(p_org,nullif(btrim(p_name),''),v_email,p_phone)
      returning id into v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- conexão
create function public.save_store_connection(p_org uuid, p_alias text, p_secret text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_conn public.store_connections; v_secret uuid;
begin
  if not public.has_role(p_org,'admin') then raise exception 'forbidden' using errcode='42501'; end if;
  if coalesce(char_length(btrim(p_alias)),0) not between 1 and 200 or coalesce(char_length(p_secret),0) not between 1 and 8192 then
    raise exception 'invalid store connection' using errcode='22023';
  end if;
  select * into v_conn from public.store_connections where organization_id=p_org for update;
  if found then
    perform vault.update_secret(v_conn.webhook_secret_id,p_secret);
    update public.store_connections set merchant_alias=btrim(p_alias) where id=v_conn.id;
    return v_conn.id;
  end if;
  v_conn.id := gen_random_uuid();
  select vault.create_secret(p_secret,'flowai-yampi-'||v_conn.id||'-secret') into v_secret;
  insert into public.store_connections(id,organization_id,merchant_alias,webhook_secret_id) values(v_conn.id,p_org,btrim(p_alias),v_secret);
  return v_conn.id;
end $$;

create function public.read_yampi_connection(p_connection uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('organizationId',c.organization_id,'secret',s.decrypted_secret)
  from public.store_connections c join vault.decrypted_secrets s on s.id=c.webhook_secret_id
  where c.id=p_connection;
$$;

-- ---------------------------------------------------------------- jornadas
-- Primeira ativação de 'cart' cria os passos padrão (mesmos textos de DEFAULT_CART_STEPS em packages/core/src/email/template.ts).
create function public.set_email_journey_enabled(p_org uuid, p_kind text, p_enabled boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_created boolean;
begin
  if not public.has_role(p_org,'admin') then raise exception 'forbidden' using errcode='42501'; end if;
  insert into public.email_journeys(organization_id,kind,enabled) values(p_org,p_kind,coalesce(p_enabled,false))
    on conflict (organization_id,kind) do update set enabled=excluded.enabled
    returning id, (xmax=0) into v_id, v_created;
  if v_created and p_kind='cart' then
    insert into public.email_journey_steps(organization_id,journey_id,position,delay_minutes,subject,heading,body,button_label,coupon,category) values
      (p_org,v_id,1,60,'{primeiro_nome}, seu carrinho está guardado','{primeiro_nome}, deixamos seu carrinho guardado',
        'Você escolheu peças com carinho na {loja}. Elas continuam esperando por você, é só voltar e finalizar quando puder.',
        'Finalizar minha compra','','marketing'),
      (p_org,v_id,2,1440,'{primeiro_nome}, suas peças ainda estão aqui','{primeiro_nome}, ainda dá tempo',
        'Passando para lembrar que seu carrinho segue reservado na {loja}. Se ficou alguma dúvida, é só responder este e-mail.',
        'Finalizar minha compra','','marketing'),
      (p_org,v_id,3,2880,'{primeiro_nome}, um presente para finalizar sua compra','{primeiro_nome}, um presente para você',
        'Para ajudar você a concluir seu pedido, use o cupom {cupom} no checkout da {loja}. Que suas peças cheguem com bênção.',
        'Finalizar minha compra','','marketing');
  end if;
  return v_id;
end $$;

-- Atualização parcial: só as chaves presentes em p_input mudam; os checks da tabela validam.
create function public.save_email_journey_step(p_org uuid, p_step uuid, p_input jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not public.has_role(p_org,'admin') then raise exception 'forbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid step input' using errcode='22023'; end if;
  update public.email_journey_steps set
    delay_minutes = case when p_input ? 'delayMinutes' then (p_input->>'delayMinutes')::int else delay_minutes end,
    enabled = case when p_input ? 'enabled' then (p_input->>'enabled')::boolean else enabled end,
    subject = case when p_input ? 'subject' then btrim(p_input->>'subject') else subject end,
    heading = case when p_input ? 'heading' then coalesce(btrim(p_input->>'heading'),'') else heading end,
    body = case when p_input ? 'body' then btrim(p_input->>'body') else body end,
    button_label = case when p_input ? 'buttonLabel' then btrim(p_input->>'buttonLabel') else button_label end,
    coupon = case when p_input ? 'coupon' then coalesce(btrim(p_input->>'coupon'),'') else coupon end
  where id=p_step and organization_id=p_org;
  if not found then raise exception 'step not found' using errcode='42501'; end if;
end $$;

-- ---------------------------------------------------------------- entrada Yampi
-- p_event é a saída de parseYampiEvent (packages/core/src/store/yampi.ts); p_body_hash é o SHA-256 do corpo.
create function public.ingest_yampi_event(p_connection uuid, p_event jsonb, p_body_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_conn public.store_connections;
  v_kind text := p_event->>'kind';
  v_res jsonb := case p_event->>'kind' when 'cart' then p_event->'cart' when 'order' then p_event->'order' end;
  v_email text := lower(btrim(p_event->'customer'->>'email'));
  v_contact uuid;
  v_cart public.store_carts;
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
    insert into public.store_carts(organization_id,connection_id,external_id,token,contact_id,total,recovery_url,items,converted_at)
      values(v_conn.organization_id,v_conn.id,v_res->>'externalId',v_res->>'token',v_contact,
        coalesce((v_res->>'total')::numeric,0),v_res->>'recoveryUrl',coalesce(v_res->'items','[]'::jsonb),
        -- pedido que chegou antes do carrinho já o converte
        case when v_res->>'token' is not null and exists(select 1 from public.store_orders o
          where o.connection_id=v_conn.id and o.cart_token=v_res->>'token') then now() end)
      on conflict (connection_id,external_id) do update set token=excluded.token, contact_id=excluded.contact_id,
        total=excluded.total, recovery_url=excluded.recovery_url, items=excluded.items,
        converted_at=coalesce(public.store_carts.converted_at,excluded.converted_at)
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
      track_url=coalesce(excluded.track_url,public.store_orders.track_url);

  if v_res->>'cartToken' is not null then
    with converted as (
      update public.store_carts set converted_at=coalesce(converted_at,now())
      where connection_id=v_conn.id and token=v_res->>'cartToken' returning id)
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

-- ---------------------------------------------------------------- grants
revoke all on function private.contact_for_email(uuid,text,text,text),
  public.ingest_yampi_event(uuid,jsonb,text),
  public.read_yampi_connection(uuid),
  public.save_store_connection(uuid,text,text),
  public.set_email_journey_enabled(uuid,text,boolean),
  public.save_email_journey_step(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_yampi_event(uuid,jsonb,text),
  public.read_yampi_connection(uuid) to service_role;
grant execute on function public.save_store_connection(uuid,text,text),
  public.set_email_journey_enabled(uuid,text,boolean),
  public.save_email_journey_step(uuid,uuid,jsonb) to authenticated;
