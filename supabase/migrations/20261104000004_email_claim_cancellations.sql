-- O limite conta envios válidos; linhas canceladas não devem bloquear os próximos.
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
