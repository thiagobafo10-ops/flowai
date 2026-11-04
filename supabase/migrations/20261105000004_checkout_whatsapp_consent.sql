-- Opção por loja: o celular informado no checkout vale como autorização de WhatsApp.
-- Revogação registrada e bloqueio do cliente continuam vencendo.

alter table public.cart_recovery_settings add column checkout_whatsapp_consent boolean not null default false;

create function private.checkout_whatsapp_consent(p_org uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select checkout_whatsapp_consent from public.cart_recovery_settings where organization_id=p_org),false)
$$;
revoke all on function private.checkout_whatsapp_consent(uuid) from public,anon,authenticated;

-- Cópia de 20261105000001 + a opção do checkout.
create or replace function private.cart_whatsapp_block_reason(p_cart uuid) returns text
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
    when v_perm is null and not private.checkout_whatsapp_consent(c.organization_id) then 'Sem autorização de contato registrada'
    when private.cart_whatsapp_phone(p_cart) is null then 'Telefone ausente ou inválido'
    when not private.checkout_url_allowed(c.recovery_url,v_hosts) then 'Link de retomada indisponível'
  end;
end $$;

-- Cópia de 20261105000002 + autorização implícita do checkout quando não há registro.
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
    'id',c.id,'externalId',c.external_id,'total',c.total,'items',c.items,
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

-- Novo parâmetro; nulo mantém o valor salvo.
drop function public.save_cart_recovery_settings(uuid,text,text[]);
create function public.save_cart_recovery_settings(p_org uuid, p_template text, p_checkout_hosts text[],
  p_checkout_whatsapp_consent boolean default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_hosts text[];
begin
  if not public.has_role(p_org,'admin') then raise exception 'forbidden' using errcode='42501'; end if;
  if coalesce(char_length(btrim(p_template)),0) not between 10 and 2000 then
    raise exception 'invalid template' using errcode='22023';
  end if;
  -- minúsculo, sem esquema, sem caminho/consulta, sem ponto final; linhas vazias ignoradas
  select coalesce(array_agg(distinct h order by h),'{}') into v_hosts from (
    select rtrim(split_part(split_part(split_part(regexp_replace(lower(btrim(x)),'^[a-z][a-z0-9+.-]*://',''),'/',1),'?',1),'#',1),'.') h
    from unnest(coalesce(p_checkout_hosts,'{}')) x) t
  where h<>'';
  if exists(select 1 from unnest(v_hosts) h where h !~ '^[a-z0-9.-]+\.[a-z]{2,}$') then
    raise exception 'invalid checkout host' using errcode='22023';
  end if;
  update public.store_connections set checkout_hosts=v_hosts where organization_id=p_org;
  if not found and v_hosts<>'{}' then raise exception 'store connection required' using errcode='22023'; end if;
  insert into public.cart_recovery_settings(organization_id,whatsapp_template,checkout_whatsapp_consent,updated_by,updated_at)
    values(p_org,btrim(p_template),coalesce(p_checkout_whatsapp_consent,false),auth.uid(),now())
    on conflict (organization_id) do update set whatsapp_template=excluded.whatsapp_template,
      checkout_whatsapp_consent=coalesce(p_checkout_whatsapp_consent,public.cart_recovery_settings.checkout_whatsapp_consent),
      updated_by=excluded.updated_by, updated_at=excluded.updated_at;
end $$;
revoke all on function public.save_cart_recovery_settings(uuid,text,text[],boolean) from public,anon;
grant execute on function public.save_cart_recovery_settings(uuid,text,text[],boolean) to authenticated;
