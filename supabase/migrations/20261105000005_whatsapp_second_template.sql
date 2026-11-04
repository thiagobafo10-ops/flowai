-- Segundo modelo de WhatsApp (ex.: cupom maior); o operador escolhe qual preparar.
-- Modelo 2 vazio usa o modelo 1.

alter table public.cart_recovery_settings add column whatsapp_template_2 text
  check (char_length(whatsapp_template_2) between 10 and 2000);

drop function private.cart_whatsapp_message(uuid);
create function private.cart_whatsapp_message(p_cart uuid, p_slot int) returns text
language sql stable security definer set search_path='' as $$
  select private.render_whatsapp_message(
    case when p_slot=2 then coalesce(s.whatsapp_template_2,s.whatsapp_template,private.default_whatsapp_template())
      else coalesce(s.whatsapp_template,private.default_whatsapp_template()) end,
    nullif(split_part(btrim(coalesce(k.name,'')),' ',1),''),
    c.recovery_url, c.total, coalesce(e.from_name,o.name), c.items)
  from public.store_carts c
  join public.contacts k on k.id=c.contact_id
  join public.organizations o on o.id=c.organization_id
  left join public.cart_recovery_settings s on s.organization_id=c.organization_id
  left join public.email_settings e on e.organization_id=c.organization_id
  where c.id=p_cart
$$;
revoke all on function private.cart_whatsapp_message(uuid,int) from public,anon,authenticated;

-- Cópia de 20261105000002 + escolha do modelo, registrada na nota da ação.
drop function public.prepare_cart_whatsapp(uuid,uuid,text);
create function public.prepare_cart_whatsapp(p_org uuid, p_cart uuid, p_request_key text, p_template int default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  c public.store_carts := private.cart_for_operator(p_org,p_cart);
  v_reason text;
  v_note text := 'Modelo '||p_template;
  v_hash text := private.cart_action_hash('opened_whatsapp',p_cart,v_note,false);
  a public.cart_contact_actions;
begin
  perform private.check_request_key(p_request_key);
  if p_template is null or p_template not in (1,2) then raise exception 'invalid template' using errcode='22023'; end if;
  v_reason := private.cart_whatsapp_block_reason(c.id);
  if v_reason is not null then return jsonb_build_object('blocked',v_reason); end if;
  a := private.cart_action_replay(p_org,p_request_key,v_hash);
  if a.id is null then
    insert into public.cart_contact_actions(organization_id,cart_id,contact_id,actor_id,action,note,request_key,request_hash)
      values(p_org,c.id,c.contact_id,auth.uid(),'opened_whatsapp',v_note,p_request_key,v_hash) returning * into a;
  end if;
  return jsonb_build_object('phone',private.cart_whatsapp_phone(c.id),'message',private.cart_whatsapp_message(c.id,p_template),'actionId',a.id);
end $$;
revoke all on function public.prepare_cart_whatsapp(uuid,uuid,text,int) from public,anon;
grant execute on function public.prepare_cart_whatsapp(uuid,uuid,text,int) to authenticated;

-- Cópia de 20261105000004 + modelo 2 (nulo mantém o salvo).
drop function public.save_cart_recovery_settings(uuid,text,text[],boolean);
create function public.save_cart_recovery_settings(p_org uuid, p_template text, p_checkout_hosts text[],
  p_checkout_whatsapp_consent boolean default null, p_template_2 text default null) returns void
language plpgsql security definer set search_path='' as $$
declare v_hosts text[];
begin
  if not public.has_role(p_org,'admin') then raise exception 'forbidden' using errcode='42501'; end if;
  if coalesce(char_length(btrim(p_template)),0) not between 10 and 2000 then
    raise exception 'invalid template' using errcode='22023';
  end if;
  if p_template_2 is not null and char_length(btrim(p_template_2)) not between 10 and 2000 then
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
  insert into public.cart_recovery_settings(organization_id,whatsapp_template,whatsapp_template_2,checkout_whatsapp_consent,updated_by,updated_at)
    values(p_org,btrim(p_template),btrim(p_template_2),coalesce(p_checkout_whatsapp_consent,false),auth.uid(),now())
    on conflict (organization_id) do update set whatsapp_template=excluded.whatsapp_template,
      whatsapp_template_2=coalesce(excluded.whatsapp_template_2,public.cart_recovery_settings.whatsapp_template_2),
      checkout_whatsapp_consent=coalesce(p_checkout_whatsapp_consent,public.cart_recovery_settings.checkout_whatsapp_consent),
      updated_by=excluded.updated_by, updated_at=excluded.updated_at;
end $$;
revoke all on function public.save_cart_recovery_settings(uuid,text,text[],boolean,text) from public,anon;
grant execute on function public.save_cart_recovery_settings(uuid,text,text[],boolean,text) to authenticated;
