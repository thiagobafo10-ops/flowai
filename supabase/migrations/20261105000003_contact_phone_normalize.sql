-- Contatos criados antes da recuperação guardam o full_number cru da Yampi (ex.: 5511999990000);
-- cart_whatsapp_phone só aceita +55 celular. Normaliza os existentes e passa a corrigir na chegada.

-- Mesma regra de normalizeBrazilMobile (packages/core/src/store/recovery.ts).
create function private.normalize_br_mobile(p text) returns text
language sql immutable set search_path='' as $$
  select case when d ~ '^[1-9][1-9]9[0-9]{8}$' then '+55'||d end
  from (select case when length(x)>11 and x like '55%' then substr(x,3) else x end as d
        from (select regexp_replace(coalesce(p,''),'[^0-9]','','g') as x) a) b
$$;

-- Só troca quando normaliza; telefone que não normaliza fica como está.
create function private.normalize_contact_phones() returns void
language sql security definer set search_path='' as $$
  update public.contacts set phone=private.normalize_br_mobile(phone)
  where phone !~ '^\+55[1-9][0-9]9[0-9]{8}$' and private.normalize_br_mobile(phone) is not null
$$;

-- Casa só por e-mail (nunca por nome). O lock evita dois contatos para o mesmo e-mail em eventos simultâneos.
-- Contato existente sem telefone válido recebe o novo; telefone válido nunca é sobrescrito.
create or replace function private.contact_for_email(p_org uuid, p_email text, p_name text, p_phone text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_email text := lower(btrim(p_email)); v_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('contact-email:'||p_org||':'||v_email,0));
  select id into v_id from public.contacts
    where organization_id=p_org and lower(btrim(email))=v_email order by created_at, id limit 1;
  if v_id is null then
    insert into public.contacts(organization_id,name,email,phone) values(p_org,nullif(btrim(p_name),''),v_email,p_phone)
      returning id into v_id;
  elsif private.normalize_br_mobile(p_phone) is not null then
    update public.contacts set phone=private.normalize_br_mobile(p_phone)
      where id=v_id and (phone is null or phone !~ '^\+55[1-9][0-9]9[0-9]{8}$');
  end if;
  return v_id;
end $$;

revoke all on function private.normalize_br_mobile(text),
  private.normalize_contact_phones(),
  private.contact_for_email(uuid,text,text,text) from public,anon,authenticated;

select private.normalize_contact_phones();
