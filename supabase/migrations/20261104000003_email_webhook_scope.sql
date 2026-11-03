-- Somente organizações cuja chave validou a assinatura podem receber o evento.
create function public.record_email_event(p_provider_id text, p_type text, p_at timestamptz, p_org_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare v_type text := substr(p_type,7); v_at timestamptz := coalesce(p_at,now()); recipient record;
begin
  if p_type is null or p_type not in ('email.delivered','email.opened','email.clicked','email.bounced','email.complained') then
    return;
  end if;
  for recipient in
    update public.email_sends set
      delivered_at=case when v_type='delivered' then coalesce(delivered_at,v_at) else delivered_at end,
      opened_at=case when v_type='opened' then coalesce(opened_at,v_at) else opened_at end,
      clicked_at=case when v_type='clicked' then coalesce(clicked_at,v_at) else clicked_at end,
      bounced_at=case when v_type='bounced' then coalesce(bounced_at,v_at) else bounced_at end
    where provider_id=p_provider_id and organization_id=any(p_org_ids)
    returning organization_id,to_email
  loop
    if v_type in ('bounced','complained') then
      insert into public.email_suppressions(organization_id,email,reason)
        values(recipient.organization_id,lower(btrim(recipient.to_email)),v_type) on conflict do nothing;
    end if;
  end loop;
end $$;

revoke all on function public.record_email_event(text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.record_email_event(text,text,timestamptz,uuid[]) from public,anon,authenticated;
grant execute on function public.record_email_event(text,text,timestamptz,uuid[]) to service_role;
